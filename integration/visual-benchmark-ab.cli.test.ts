import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  resolveVisualBenchmarkAbCliResolution,
  runVisualBenchmarkAbCli,
} from "./visual-benchmark-ab.cli.js";
import type {
  VisualBenchmarkAbConfig,
  VisualBenchmarkAbResult,
} from "./visual-benchmark-ab.js";

// ---------------------------------------------------------------------------
// CLI parser
// ---------------------------------------------------------------------------

test("resolveVisualBenchmarkAbCliResolution requires both config flags", () => {
  assert.throws(
    () => resolveVisualBenchmarkAbCliResolution([]),
    /Both --config-a and --config-b are required/i,
  );
});

test("resolveVisualBenchmarkAbCliResolution accepts the canonical flag set", () => {
  const resolution = resolveVisualBenchmarkAbCliResolution([
    "--config-a",
    "configs/strict.json",
    "--config-b",
    "configs/loose.json",
  ]);
  assert.equal(resolution.configAPath, "configs/strict.json");
  assert.equal(resolution.configBPath, "configs/loose.json");
  assert.equal(resolution.enforceNoRegression, false);
  assert.equal(resolution.skipThreeWayDiff, false);
});

test("resolveVisualBenchmarkAbCliResolution resolves --artifact-root to absolute path", () => {
  const resolution = resolveVisualBenchmarkAbCliResolution([
    "--config-a",
    "a.json",
    "--config-b",
    "b.json",
    "--artifact-root",
    "build/ab-output",
  ]);
  assert.equal(
    resolution.artifactRoot,
    path.resolve(process.cwd(), "build/ab-output"),
  );
});

test("resolveVisualBenchmarkAbCliResolution parses --neutral-tolerance", () => {
  const resolution = resolveVisualBenchmarkAbCliResolution([
    "--config-a",
    "a.json",
    "--config-b",
    "b.json",
    "--neutral-tolerance",
    "2.5",
  ]);
  assert.equal(resolution.neutralTolerance, 2.5);
});

test("resolveVisualBenchmarkAbCliResolution rejects out-of-range --neutral-tolerance", () => {
  assert.throws(
    () =>
      resolveVisualBenchmarkAbCliResolution([
        "--config-a",
        "a.json",
        "--config-b",
        "b.json",
        "--neutral-tolerance",
        "200",
      ]),
    /finite number between 0 and 100/i,
  );
});

test("resolveVisualBenchmarkAbCliResolution accepts --enforce-no-regression and --skip-three-way-diff", () => {
  const resolution = resolveVisualBenchmarkAbCliResolution([
    "--config-a",
    "a.json",
    "--config-b",
    "b.json",
    "--enforce-no-regression",
    "--skip-three-way-diff",
  ]);
  assert.equal(resolution.enforceNoRegression, true);
  assert.equal(resolution.skipThreeWayDiff, true);
});

test("resolveVisualBenchmarkAbCliResolution rejects unknown flags", () => {
  assert.throws(
    () =>
      resolveVisualBenchmarkAbCliResolution([
        "--config-a",
        "a.json",
        "--config-b",
        "b.json",
        "--mystery",
      ]),
    /Unknown argument/i,
  );
});

// ---------------------------------------------------------------------------
// CLI orchestration
// ---------------------------------------------------------------------------

const buildAbResult = (
  override?: Partial<VisualBenchmarkAbResult>,
): VisualBenchmarkAbResult => ({
  configA: { label: "A", overallScore: 80 },
  configB: { label: "B", overallScore: 82 },
  entries: [
    {
      fixtureId: "simple-form",
      screenId: "1:65671",
      scoreA: 80,
      scoreB: 82,
      delta: 2,
      indicator: "improved",
    },
  ],
  overallDelta: 2,
  statistics: {
    totalEntries: 1,
    comparedEntries: 1,
    improvedCount: 1,
    degradedCount: 0,
    neutralCount: 0,
    unavailableCount: 0,
    meanDelta: 2,
    meanImprovement: 2,
    bestImprovement: 2,
    worstRegression: 2,
    netChange: 2,
  },
  ...override,
});

test("runVisualBenchmarkAbCli loads both configs, runs the comparison, and persists", async () => {
  const seenLoadPaths: string[] = [];
  const persistedComparisons: { artifactRoot: string; tableLength: number }[] =
    [];
  const persistedThreeWay: { artifactRoot: string }[] = [];
  const lines: string[] = [];
  const status = await runVisualBenchmarkAbCli(
    [
      "--config-a",
      "configs/strict.json",
      "--config-b",
      "configs/loose.json",
      "--artifact-root",
      "build/ab",
    ],
    {
      loadConfig: async (
        filePath: string,
      ): Promise<VisualBenchmarkAbConfig> => {
        seenLoadPaths.push(filePath);
        return { label: filePath.includes("strict") ? "Strict" : "Loose" };
      },
      runAb: async () => buildAbResult(),
      persistComparison: async (_result, artifactRoot, table) => {
        persistedComparisons.push({
          artifactRoot,
          tableLength: table.length,
        });
      },
      persistThreeWayDiffs: async (_result, artifactRoot) => {
        persistedThreeWay.push({ artifactRoot });
      },
      output: (line) => lines.push(line),
    },
  );
  assert.equal(status, 0);
  assert.deepEqual(seenLoadPaths, [
    "configs/strict.json",
    "configs/loose.json",
  ]);
  assert.equal(persistedComparisons.length, 1);
  assert.ok(persistedComparisons[0]!.tableLength > 0);
  assert.equal(persistedThreeWay.length, 1);
  assert.ok(lines.some((line) => line.includes("Overall Average")));
  assert.ok(lines.some((line) => line.includes("Statistical summary")));
});

test("runVisualBenchmarkAbCli skips three-way diff generation when --skip-three-way-diff is set", async () => {
  const persistedThreeWay: { artifactRoot: string }[] = [];
  await runVisualBenchmarkAbCli(
    ["--config-a", "a.json", "--config-b", "b.json", "--skip-three-way-diff"],
    {
      loadConfig: async () => ({ label: Math.random().toString() }),
      runAb: async () => buildAbResult(),
      persistComparison: async () => undefined,
      persistThreeWayDiffs: async (_result, artifactRoot) => {
        persistedThreeWay.push({ artifactRoot });
      },
      output: () => undefined,
    },
  );
  assert.equal(persistedThreeWay.length, 0);
});

test("runVisualBenchmarkAbCli reports three-way diff failures without aborting", async () => {
  const lines: string[] = [];
  const status = await runVisualBenchmarkAbCli(
    ["--config-a", "a.json", "--config-b", "b.json"],
    {
      loadConfig: async () => ({ label: Math.random().toString() }),
      runAb: async () => buildAbResult(),
      persistComparison: async () => undefined,
      persistThreeWayDiffs: async () => {
        throw new Error("disk full");
      },
      output: (line) => lines.push(line),
    },
  );
  assert.equal(status, 0);
  assert.ok(
    lines.some((line) =>
      line.includes("Three-way diff generation skipped: disk full"),
    ),
  );
});

test("runVisualBenchmarkAbCli returns exit code 1 with --enforce-no-regression when degraded entries are present", async () => {
  const status = await runVisualBenchmarkAbCli(
    [
      "--config-a",
      "a.json",
      "--config-b",
      "b.json",
      "--enforce-no-regression",
      "--skip-three-way-diff",
    ],
    {
      loadConfig: async () => ({ label: Math.random().toString() }),
      runAb: async () =>
        buildAbResult({
          statistics: {
            totalEntries: 1,
            comparedEntries: 1,
            improvedCount: 0,
            degradedCount: 1,
            neutralCount: 0,
            unavailableCount: 0,
            meanDelta: -3,
            meanImprovement: null,
            bestImprovement: null,
            worstRegression: -3,
            netChange: -3,
          },
        }),
      persistComparison: async () => undefined,
      output: () => undefined,
    },
  );
  assert.equal(status, 1);
});

test("runVisualBenchmarkAbCli prints labelled warnings when present", async () => {
  const lines: string[] = [];
  await runVisualBenchmarkAbCli(
    ["--config-a", "a.json", "--config-b", "b.json", "--skip-three-way-diff"],
    {
      loadConfig: async () => ({ label: Math.random().toString() }),
      runAb: async () =>
        buildAbResult({
          warnings: ["[A] stale baseline"],
        }),
      persistComparison: async () => undefined,
      output: (line) => lines.push(line),
    },
  );
  assert.ok(lines.some((line) => line.includes("Warnings:")));
  assert.ok(lines.some((line) => line.includes("[A] stale baseline")));
});
