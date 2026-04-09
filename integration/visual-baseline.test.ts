import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  loadVisualBenchmarkLastRunArtifact,
  saveVisualBenchmarkBaselineScores,
  saveVisualBenchmarkLastRun,
  saveVisualBenchmarkLastRunArtifact,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
} from "./visual-benchmark.helpers.js";
import {
  approveVisualBaseline,
  computeVisualBaselineDiff,
  computeVisualBaselineStatus,
  formatVisualBaselineDiffTable,
  formatVisualBaselineStatusTable,
  updateVisualBaselines,
  type VisualBaselineDiffResult,
  type VisualBaselineStatusResult,
} from "./visual-baseline.js";
import {
  parseVisualBaselineCliArgs,
  runVisualBaselineCli,
} from "./visual-baseline.cli.js";

const createTestPngBuffer = (width: number, height: number, rgba: readonly [number, number, number, number]): Buffer => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      png.data[index] = rgba[0];
      png.data[index + 1] = rgba[1];
      png.data[index + 2] = rgba[2];
      png.data[index + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
};

const createFixtureMetadata = (fixtureId: string): VisualBenchmarkFixtureMetadata => ({
  version: 1,
  fixtureId,
  capturedAt: "2026-04-01T00:00:00.000Z",
  source: {
    fileKey: "test",
    nodeId: "1:1",
    nodeName: fixtureId,
    lastModified: "2026-04-01T00:00:00.000Z",
  },
  viewport: { width: 1280, height: 720 },
  export: { format: "png", scale: 2 },
});

const createFixtureManifest = (fixtureId: string): VisualBenchmarkFixtureManifest => ({
  version: 1,
  fixtureId,
  visualQuality: {
    frozenReferenceImage: "reference.png",
    frozenReferenceMetadata: "metadata.json",
  },
});

const createFixtureEnvironment = async (options?: {
  fixtureIds?: string[];
  baselineScores?: VisualBenchmarkScoreEntry[];
  lastRunScores?: VisualBenchmarkScoreEntry[];
}): Promise<{ fixtureRoot: string; artifactRoot: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-baseline-"));
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  const fixtureIds = options?.fixtureIds ?? ["simple-form"];

  for (const fixtureId of fixtureIds) {
    await mkdir(path.join(fixtureRoot, fixtureId), { recursive: true });
    await writeVisualBenchmarkFixtureManifest(fixtureId, createFixtureManifest(fixtureId), { fixtureRoot, artifactRoot });
    await writeVisualBenchmarkFixtureMetadata(fixtureId, createFixtureMetadata(fixtureId), { fixtureRoot, artifactRoot });
    await writeVisualBenchmarkFixtureInputs(
      fixtureId,
      {
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              name: fixtureId,
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 720 },
            },
          },
        },
      },
      { fixtureRoot, artifactRoot },
    );
    await writeVisualBenchmarkReference(fixtureId, createTestPngBuffer(8, 8, [0, 100, 200, 255]), { fixtureRoot, artifactRoot });
  }

  if (options?.baselineScores) {
    await saveVisualBenchmarkBaselineScores(options.baselineScores, { fixtureRoot, artifactRoot });
  }

  if (options?.lastRunScores) {
    await saveVisualBenchmarkLastRun(options.lastRunScores, { fixtureRoot, artifactRoot }, "2026-04-08T00:00:00.000Z");
  }

  return { fixtureRoot, artifactRoot };
};

// ---------------------------------------------------------------------------
// 1. CLI argument parsing tests
// ---------------------------------------------------------------------------

test("parseVisualBaselineCliArgs parses update command", () => {
  const result = parseVisualBaselineCliArgs(["update"]);
  assert.deepEqual(result, { command: "update", fixture: undefined, screen: undefined, json: false });
});

test("parseVisualBaselineCliArgs parses update with --fixture", () => {
  const result = parseVisualBaselineCliArgs(["update", "--fixture", "simple-form"]);
  assert.deepEqual(result, { command: "update", fixture: "simple-form", screen: undefined, json: false });
});

test("parseVisualBaselineCliArgs parses approve with --screen", () => {
  const result = parseVisualBaselineCliArgs(["approve", "--screen", "simple-form"]);
  assert.deepEqual(result, { command: "approve", fixture: undefined, screen: "simple-form", json: false });
});

test("parseVisualBaselineCliArgs parses status with --json", () => {
  const result = parseVisualBaselineCliArgs(["status", "--json"]);
  assert.deepEqual(result, { command: "status", fixture: undefined, screen: undefined, json: true });
});

test("parseVisualBaselineCliArgs parses diff command", () => {
  const result = parseVisualBaselineCliArgs(["diff"]);
  assert.deepEqual(result, { command: "diff", fixture: undefined, screen: undefined, json: false });
});

test("parseVisualBaselineCliArgs strips leading --", () => {
  const result = parseVisualBaselineCliArgs(["--", "status"]);
  assert.deepEqual(result, { command: "status", fixture: undefined, screen: undefined, json: false });
});

test("parseVisualBaselineCliArgs throws on empty args", () => {
  assert.throws(() => parseVisualBaselineCliArgs([]), /Usage:/);
});

test("parseVisualBaselineCliArgs throws on unknown command", () => {
  assert.throws(() => parseVisualBaselineCliArgs(["unknown"]), /Unknown command 'unknown'/);
});

test("parseVisualBaselineCliArgs throws when approve missing --screen", () => {
  assert.throws(() => parseVisualBaselineCliArgs(["approve"]), /--screen <name> is required/);
});

test("parseVisualBaselineCliArgs throws on unknown option", () => {
  assert.throws(() => parseVisualBaselineCliArgs(["status", "--verbose"]), /Unknown option/);
});

// ---------------------------------------------------------------------------
// 2. updateVisualBaselines tests
// ---------------------------------------------------------------------------

test("updateVisualBaselines rewrites references, metadata, artifacts, and baseline", async () => {
  const env = await createFixtureEnvironment();
  const runAt = new Date("2026-04-09T12:00:00.000Z");
  const actualBuffer = createTestPngBuffer(8, 8, [255, 0, 0, 255]);
  const diffBuffer = createTestPngBuffer(8, 8, [0, 255, 0, 255]);

  try {
    const result = await updateVisualBaselines({
      ...env,
      log: () => {},
      now: () => runAt,
      executeFixture: async (fixtureId) => ({
        fixtureId,
        score: 92,
        screenshotBuffer: actualBuffer,
        diffBuffer,
        report: { fixtureId, outcome: "ok" },
        viewport: { width: 1440, height: 900 },
      }),
    });

    assert.equal(result.scores.length, 1);
    assert.equal(result.scores[0]?.score, 92);
    assert.equal(result.artifacts.length, 1);

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.equal(baseline.version, 2);
    assert.deepEqual(baseline.scores, [{ fixtureId: "simple-form", score: 92 }]);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.ok(lastRun !== null);
    assert.equal(lastRun.scores[0]?.score, 92);

    const metadata = await loadVisualBenchmarkFixtureMetadata("simple-form", env);
    assert.equal(metadata.capturedAt, runAt.toISOString());
    assert.deepEqual(metadata.viewport, { width: 1440, height: 900 });

    const reference = await loadVisualBenchmarkReference("simple-form", env);
    assert.deepEqual(reference, actualBuffer);

    const artifact = await loadVisualBenchmarkLastRunArtifact("simple-form", env);
    assert.ok(artifact !== null);
    assert.equal(artifact.score, 92);
    assert.equal(artifact.ranAt, runAt.toISOString());
    assert.ok(artifact.actualImagePath.endsWith("artifacts/last-run/simple-form/actual.png"));
    assert.ok(artifact.diffImagePath?.endsWith("artifacts/last-run/simple-form/diff.png"));
    assert.ok(artifact.reportPath?.endsWith("artifacts/last-run/simple-form/report.json"));
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines with single fixture merges into existing baseline and last-run state", async () => {
  const env = await createFixtureEnvironment({
    fixtureIds: ["simple-form", "complex-dashboard"],
    baselineScores: [
      { fixtureId: "simple-form", score: 85 },
      { fixtureId: "complex-dashboard", score: 90 },
    ],
    lastRunScores: [
      { fixtureId: "complex-dashboard", score: 88 },
    ],
  });
  const runAt = new Date("2026-04-09T12:00:00.000Z");

  try {
    const result = await updateVisualBaselines({
      ...env,
      fixtureId: "simple-form",
      log: () => {},
      now: () => runAt,
      executeFixture: async (fixtureId) => ({
        fixtureId,
        score: 95,
        screenshotBuffer: createTestPngBuffer(8, 8, [10, 20, 30, 255]),
        diffBuffer: createTestPngBuffer(8, 8, [200, 20, 30, 255]),
        report: { fixtureId, outcome: "merged" },
        viewport: { width: 1024, height: 768 },
      }),
    });

    assert.equal(result.scores.length, 1);
    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [
      { fixtureId: "complex-dashboard", score: 90 },
      { fixtureId: "simple-form", score: 95 },
    ]);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.ok(lastRun !== null);
    assert.deepEqual(lastRun.scores, [
      { fixtureId: "complex-dashboard", score: 88 },
      { fixtureId: "simple-form", score: 95 },
    ]);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. approveVisualBaseline tests
// ---------------------------------------------------------------------------

test("approveVisualBaseline updates baseline and committed reference from persisted artifact", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  const actualBuffer = createTestPngBuffer(8, 8, [200, 10, 10, 255]);
  const diffBuffer = createTestPngBuffer(8, 8, [10, 200, 10, 255]);
  const artifactTime = "2026-04-09T15:00:00.000Z";

  try {
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        score: 95,
        ranAt: artifactTime,
        viewport: { width: 1366, height: 768 },
        actualImageBuffer: actualBuffer,
        diffImageBuffer: diffBuffer,
        report: { approved: true },
      },
      env,
    );

    const result = await approveVisualBaseline("simple-form", env);
    assert.equal(result.previousScore, 90);
    assert.equal(result.newScore, 95);

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [{ fixtureId: "simple-form", score: 95 }]);

    const metadata = await loadVisualBenchmarkFixtureMetadata("simple-form", env);
    assert.equal(metadata.capturedAt, artifactTime);
    assert.deepEqual(metadata.viewport, { width: 1366, height: 768 });

    const reference = await loadVisualBenchmarkReference("simple-form", env);
    assert.deepEqual(reference, actualBuffer);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("approveVisualBaseline throws when no persisted artifact exists", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  try {
    await assert.rejects(
      async () => approveVisualBaseline("simple-form", env),
      /No last-run artifact found/,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. computeVisualBaselineStatus tests
// ---------------------------------------------------------------------------

test("computeVisualBaselineStatus shows captured age and persisted last-run artifacts", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  const artifactTime = "2026-04-08T18:00:00.000Z";

  try {
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        score: 95,
        ranAt: artifactTime,
        viewport: { width: 1280, height: 720 },
        actualImageBuffer: createTestPngBuffer(8, 8, [100, 0, 0, 255]),
        diffImageBuffer: createTestPngBuffer(8, 8, [0, 100, 0, 255]),
        report: { diff: true },
      },
      env,
    );

    const status = await computeVisualBaselineStatus({
      ...env,
      now: () => new Date("2026-04-10T00:00:00.000Z"),
      log: () => {},
    });

    assert.equal(status.entries.length, 1);
    const entry = status.entries[0];
    assert.ok(entry);
    assert.equal(entry.fixtureId, "simple-form");
    assert.equal(entry.baselineScore, 90);
    assert.equal(entry.lastRunScore, 95);
    assert.equal(entry.hasPendingDiff, true);
    assert.equal(entry.referencePngExists, true);
    assert.equal(entry.capturedAt, "2026-04-01T00:00:00.000Z");
    assert.equal(entry.ageInDays, 9);
    assert.equal(entry.lastRunAt, artifactTime);
    assert.ok(entry.actualImagePath?.endsWith("artifacts/last-run/simple-form/actual.png"));
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("computeVisualBaselineStatus handles missing baseline and last-run artifact", async () => {
  const env = await createFixtureEnvironment();
  try {
    const status = await computeVisualBaselineStatus({
      ...env,
      now: () => new Date("2026-04-10T00:00:00.000Z"),
      log: () => {},
    });

    const entry = status.entries[0];
    assert.ok(entry);
    assert.equal(entry.baselineScore, null);
    assert.equal(entry.lastRunScore, null);
    assert.equal(entry.hasPendingDiff, false);
    assert.equal(entry.actualImagePath, null);
    assert.equal(entry.lastRunAt, null);
    assert.equal(entry.ageInDays, 9);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. computeVisualBaselineDiff tests
// ---------------------------------------------------------------------------

test("computeVisualBaselineDiff computes deltas and returns artifact paths", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 95 }],
  });

  try {
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        score: 95,
        ranAt: "2026-04-09T12:00:00.000Z",
        viewport: { width: 1280, height: 720 },
        actualImageBuffer: createTestPngBuffer(8, 8, [255, 0, 0, 255]),
        diffImageBuffer: createTestPngBuffer(8, 8, [0, 255, 0, 255]),
        report: { diff: true },
      },
      env,
    );

    const diff = await computeVisualBaselineDiff(env);
    const entry = diff.diffs[0];
    assert.ok(entry);
    assert.equal(entry.fixtureId, "simple-form");
    assert.equal(entry.baseline, 90);
    assert.equal(entry.current, 95);
    assert.equal(entry.delta, 5);
    assert.equal(entry.indicator, "improved");
    assert.ok(entry.actualImagePath?.endsWith("artifacts/last-run/simple-form/actual.png"));
    assert.ok(entry.diffImagePath?.endsWith("artifacts/last-run/simple-form/diff.png"));
    assert.ok(entry.reportPath?.endsWith("artifacts/last-run/simple-form/report.json"));
    assert.equal(diff.hasPendingDiffs, true);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff detects neutral deltas within tolerance", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 100 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 100 }],
  });
  try {
    const diff = await computeVisualBaselineDiff(env);
    assert.equal(diff.diffs[0]?.indicator, "neutral");
    assert.equal(diff.hasPendingDiffs, false);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff throws when no last run summary exists", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  try {
    await assert.rejects(
      async () => computeVisualBaselineDiff(env),
      /No last run found/,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. Table formatting tests
// ---------------------------------------------------------------------------

test("formatVisualBaselineStatusTable produces a table with captured and age columns", () => {
  const statusResult: VisualBaselineStatusResult = {
    entries: [
      {
        fixtureId: "simple-form",
        baselineScore: 90,
        lastRunScore: 95,
        hasPendingDiff: true,
        capturedAt: "2026-04-01T00:00:00.000Z",
        ageInDays: 9,
        lastRunAt: "2026-04-09T00:00:00.000Z",
        referencePngExists: true,
        actualImagePath: "artifacts/last-run/simple-form/actual.png",
        diffImagePath: "artifacts/last-run/simple-form/diff.png",
        reportPath: "artifacts/last-run/simple-form/report.json",
      },
    ],
  };
  const table = formatVisualBaselineStatusTable(statusResult);
  assert.ok(table.includes("Fixture"));
  assert.ok(table.includes("Captured"));
  assert.ok(table.includes("Age"));
  assert.ok(table.includes("Simple Form"));
});

test("formatVisualBaselineDiffTable produces a table with run date column", () => {
  const diffResult: VisualBaselineDiffResult = {
    diffs: [
      {
        fixtureId: "simple-form",
        baseline: 90,
        current: 95,
        delta: 5,
        indicator: "improved",
        ranAt: "2026-04-09T12:00:00.000Z",
        actualImagePath: "artifacts/last-run/simple-form/actual.png",
        diffImagePath: "artifacts/last-run/simple-form/diff.png",
        reportPath: "artifacts/last-run/simple-form/report.json",
      },
    ],
    hasPendingDiffs: true,
  };
  const table = formatVisualBaselineDiffTable(diffResult);
  assert.ok(table.includes("Run Date"));
  assert.ok(table.includes("Simple Form"));
});

// ---------------------------------------------------------------------------
// 7. CLI routing test
// ---------------------------------------------------------------------------

test("runVisualBaselineCli routes to the correct command", async () => {
  const commands: string[] = [];
  const status = await runVisualBaselineCli(["status"], {
    runCommand: async (command) => {
      commands.push(command);
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(commands, ["status"]);
});
