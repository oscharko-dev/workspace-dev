import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  saveVisualBenchmarkBaseline,
  saveVisualBenchmarkLastRun,
  loadVisualBenchmarkBaseline,
  type VisualBenchmarkResult,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
} from "./visual-benchmark.helpers.js";
import {
  updateVisualBaselines,
  approveVisualBaseline,
  computeVisualBaselineStatus,
  computeVisualBaselineDiff,
  formatVisualBaselineStatusTable,
  formatVisualBaselineDiffTable,
  type VisualBaselineStatusResult,
  type VisualBaselineDiffResult,
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

const simpleFormMetadata: VisualBenchmarkFixtureMetadata = {
  version: 1,
  fixtureId: "simple-form",
  capturedAt: "2026-04-09T00:00:00.000Z",
  source: {
    fileKey: "test",
    nodeId: "1:1",
    nodeName: "simple-form",
    lastModified: "2026-04-09T00:00:00.000Z",
  },
  viewport: { width: 1280, height: 720 },
  export: { format: "png", scale: 2 },
};

const simpleFormManifest: VisualBenchmarkFixtureManifest = {
  version: 1,
  fixtureId: "simple-form",
  visualQuality: {
    frozenReferenceImage: "reference.png",
    frozenReferenceMetadata: "metadata.json",
  },
};

const createTestFixtureRoot = async (options?: {
  fixtureIds?: string[];
  baselineScores?: { fixtureId: string; score: number }[];
  lastRunScores?: { fixtureId: string; score: number }[];
}): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-baseline-"));
  const fixtureIds = options?.fixtureIds ?? ["simple-form"];

  for (const fixtureId of fixtureIds) {
    await mkdir(path.join(root, fixtureId), { recursive: true });
    await writeVisualBenchmarkFixtureManifest(fixtureId, {
      version: 1,
      fixtureId,
      visualQuality: { frozenReferenceImage: "reference.png", frozenReferenceMetadata: "metadata.json" },
    }, { fixtureRoot: root });
    await writeVisualBenchmarkFixtureMetadata(fixtureId, {
      version: 1,
      fixtureId,
      capturedAt: "2026-04-09T00:00:00.000Z",
      source: { fileKey: "test", nodeId: "1:1", nodeName: fixtureId, lastModified: "2026-04-09T00:00:00.000Z" },
      viewport: { width: 1280, height: 720 },
      export: { format: "png", scale: 2 },
    }, { fixtureRoot: root });
    await writeVisualBenchmarkFixtureInputs(fixtureId, { nodes: {} }, { fixtureRoot: root });
    await writeVisualBenchmarkReference(fixtureId, createTestPngBuffer(8, 8, [0, 100, 200, 255]), { fixtureRoot: root });
  }

  if (options?.baselineScores) {
    const result: VisualBenchmarkResult = {
      deltas: options.baselineScores.map((s) => ({
        fixtureId: s.fixtureId,
        baseline: null,
        current: s.score,
        delta: null,
        indicator: "neutral" as const,
      })),
      overallBaseline: null,
      overallCurrent: options.baselineScores.reduce((sum, s) => sum + s.score, 0) / options.baselineScores.length,
      overallDelta: null,
    };
    await saveVisualBenchmarkBaseline(result, { fixtureRoot: root });
  }

  if (options?.lastRunScores) {
    await saveVisualBenchmarkLastRun(options.lastRunScores, { fixtureRoot: root });
  }

  return root;
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

test("updateVisualBaselines runs all fixtures and saves baseline", async () => {
  const root = await createTestFixtureRoot();
  try {
    const result = await updateVisualBaselines({
      fixtureRoot: root,
      log: () => {},
      runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 92 }),
    });

    assert.equal(result.scores.length, 1);
    assert.equal(result.scores[0]?.fixtureId, "simple-form");
    assert.equal(result.scores[0]?.score, 92);
    assert.equal(result.previousBaseline, null);

    const baseline = await loadVisualBenchmarkBaseline({ fixtureRoot: root });
    assert.ok(baseline !== null);
    assert.equal(baseline.scores.length, 1);
    assert.equal(baseline.scores[0]?.fixtureId, "simple-form");
    assert.equal(baseline.scores[0]?.score, 92);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updateVisualBaselines with single fixture merges into existing baseline", async () => {
  const root = await createTestFixtureRoot({
    fixtureIds: ["simple-form", "complex-dashboard"],
    baselineScores: [
      { fixtureId: "simple-form", score: 85 },
      { fixtureId: "complex-dashboard", score: 90 },
    ],
  });
  try {
    const result = await updateVisualBaselines({
      fixtureRoot: root,
      fixtureId: "simple-form",
      log: () => {},
      runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 95 }),
    });

    assert.equal(result.scores.length, 1);
    assert.equal(result.scores[0]?.fixtureId, "simple-form");
    assert.equal(result.scores[0]?.score, 95);

    const baseline = await loadVisualBenchmarkBaseline({ fixtureRoot: root });
    assert.ok(baseline !== null);
    assert.equal(baseline.scores.length, 2);

    const simpleFormEntry = baseline.scores.find((s) => s.fixtureId === "simple-form");
    const dashboardEntry = baseline.scores.find((s) => s.fixtureId === "complex-dashboard");
    assert.ok(simpleFormEntry);
    assert.equal(simpleFormEntry.score, 95);
    assert.ok(dashboardEntry);
    assert.equal(dashboardEntry.score, 90);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. approveVisualBaseline tests
// ---------------------------------------------------------------------------

test("approveVisualBaseline updates baseline from last-run", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 95 }],
  });
  try {
    const result = await approveVisualBaseline("simple-form", { fixtureRoot: root, log: () => {} });

    assert.equal(result.fixtureId, "simple-form");
    assert.equal(result.previousScore, 90);
    assert.equal(result.newScore, 95);

    const baseline = await loadVisualBenchmarkBaseline({ fixtureRoot: root });
    assert.ok(baseline !== null);
    const entry = baseline.scores.find((s) => s.fixtureId === "simple-form");
    assert.ok(entry);
    assert.equal(entry.score, 95);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approveVisualBaseline throws when no last-run exists", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  try {
    await assert.rejects(
      async () => approveVisualBaseline("simple-form", { fixtureRoot: root, log: () => {} }),
      /No last run found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approveVisualBaseline throws when screen not in last-run", async () => {
  const root = await createTestFixtureRoot({
    lastRunScores: [{ fixtureId: "other-fixture", score: 88 }],
  });
  try {
    await assert.rejects(
      async () => approveVisualBaseline("simple-form", { fixtureRoot: root, log: () => {} }),
      /Screen 'simple-form' not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. computeVisualBaselineStatus tests
// ---------------------------------------------------------------------------

test("computeVisualBaselineStatus shows status for all fixtures", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 95 }],
  });
  try {
    const status = await computeVisualBaselineStatus({ fixtureRoot: root, log: () => {} });

    assert.equal(status.entries.length, 1);
    const entry = status.entries[0];
    assert.ok(entry);
    assert.equal(entry.fixtureId, "simple-form");
    assert.equal(entry.baselineScore, 90);
    assert.equal(entry.lastRunScore, 95);
    assert.equal(entry.hasPendingDiff, true);
    assert.equal(entry.referencePngExists, true);
    assert.ok(status.baselineUpdatedAt !== null);
    assert.ok(status.lastRunAt !== null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computeVisualBaselineStatus handles missing baseline and last-run", async () => {
  const root = await createTestFixtureRoot();
  try {
    const status = await computeVisualBaselineStatus({ fixtureRoot: root, log: () => {} });

    assert.equal(status.entries.length, 1);
    const entry = status.entries[0];
    assert.ok(entry);
    assert.equal(entry.baselineScore, null);
    assert.equal(entry.lastRunScore, null);
    assert.equal(entry.hasPendingDiff, false);
    assert.equal(status.baselineUpdatedAt, null);
    assert.equal(status.lastRunAt, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. computeVisualBaselineDiff tests
// ---------------------------------------------------------------------------

test("computeVisualBaselineDiff computes deltas from last-run vs baseline", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 95 }],
  });
  try {
    const diff = await computeVisualBaselineDiff({ fixtureRoot: root, log: () => {} });

    assert.equal(diff.diffs.length, 1);
    const entry = diff.diffs[0];
    assert.ok(entry);
    assert.equal(entry.fixtureId, "simple-form");
    assert.equal(entry.baseline, 90);
    assert.equal(entry.current, 95);
    assert.equal(entry.delta, 5);
    assert.equal(entry.indicator, "improved");
    assert.equal(diff.hasPendingDiffs, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff detects neutral when within tolerance", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 100 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 100 }],
  });
  try {
    const diff = await computeVisualBaselineDiff({ fixtureRoot: root, log: () => {} });

    assert.equal(diff.diffs.length, 1);
    const entry = diff.diffs[0];
    assert.ok(entry);
    assert.equal(entry.delta, 0);
    assert.equal(entry.indicator, "neutral");
    assert.equal(diff.hasPendingDiffs, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff marks new fixtures", async () => {
  const root = await createTestFixtureRoot({
    lastRunScores: [{ fixtureId: "simple-form", score: 88 }],
  });
  try {
    const diff = await computeVisualBaselineDiff({ fixtureRoot: root, log: () => {} });

    assert.equal(diff.diffs.length, 1);
    const entry = diff.diffs[0];
    assert.ok(entry);
    assert.equal(entry.baseline, null);
    assert.equal(entry.delta, null);
    assert.equal(entry.indicator, "new");
    assert.equal(diff.hasPendingDiffs, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff throws when no last-run", async () => {
  const root = await createTestFixtureRoot({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  try {
    await assert.rejects(
      async () => computeVisualBaselineDiff({ fixtureRoot: root, log: () => {} }),
      /No last run found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. Table formatting tests
// ---------------------------------------------------------------------------

test("formatVisualBaselineStatusTable produces a table with expected structure", () => {
  const statusResult: VisualBaselineStatusResult = {
    entries: [
      {
        fixtureId: "simple-form",
        baselineScore: 90,
        lastRunScore: 95,
        hasPendingDiff: true,
        baselineUpdatedAt: "2026-04-09T00:00:00.000Z",
        referencePngExists: true,
      },
    ],
    baselineUpdatedAt: "2026-04-09T00:00:00.000Z",
    lastRunAt: "2026-04-09T12:00:00.000Z",
  };
  const table = formatVisualBaselineStatusTable(statusResult);
  assert.ok(table.includes("Fixture"), "Table should contain 'Fixture' header.");
  assert.ok(table.includes("Baseline"), "Table should contain 'Baseline' header.");
  assert.ok(table.includes("Last Run"), "Table should contain 'Last Run' header.");
  assert.ok(table.includes("Diff"), "Table should contain 'Diff' header.");
  assert.ok(table.includes("Reference"), "Table should contain 'Reference' header.");
  assert.ok(table.includes("Simple Form"), "Table should contain fixture display name.");
});

test("formatVisualBaselineDiffTable produces a table with expected structure", () => {
  const diffResult: VisualBaselineDiffResult = {
    diffs: [
      {
        fixtureId: "simple-form",
        baseline: 90,
        current: 95,
        delta: 5,
        indicator: "improved",
      },
    ],
    hasPendingDiffs: true,
  };
  const table = formatVisualBaselineDiffTable(diffResult);
  assert.ok(table.includes("Fixture"), "Table should contain 'Fixture' header.");
  assert.ok(table.includes("Baseline"), "Table should contain 'Baseline' header.");
  assert.ok(table.includes("Current"), "Table should contain 'Current' header.");
  assert.ok(table.includes("Delta"), "Table should contain 'Delta' header.");
  assert.ok(table.includes("Simple Form"), "Table should contain fixture display name.");
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
