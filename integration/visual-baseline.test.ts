import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  loadVisualBenchmarkLastRunArtifact,
  loadVisualBenchmarkLastRunArtifacts,
  saveVisualBenchmarkBaselineScores,
  saveVisualBenchmarkLastRun,
  saveVisualBenchmarkLastRunArtifact,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  loadVisualBenchmarkHistory,
  saveVisualBenchmarkHistory,
} from "./visual-benchmark-history.js";
import {
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  resolveVisualBenchmarkScreenPaths,
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

const createMultiScreenFixtureMetadata = (fixtureId: string): VisualBenchmarkFixtureMetadata => ({
  version: 2,
  fixtureId,
  capturedAt: "2026-04-01T00:00:00.000Z",
  source: {
    fileKey: "test",
    nodeId: "2:10001",
    nodeName: "Home",
    lastModified: "2026-04-01T00:00:00.000Z",
  },
  viewport: { width: 1280, height: 720 },
  export: { format: "png", scale: 2 },
  screens: [
    {
      screenId: "2:10001",
      screenName: "Home",
      nodeId: "2:10001",
      viewport: { width: 1280, height: 720 },
      weight: 2,
    },
    {
      screenId: "2:10002",
      screenName: "Settings",
      nodeId: "2:10002",
      viewport: { width: 1440, height: 900 },
      weight: 1,
    },
  ],
});

const createStorybookComponentFixtureMetadata = (
  fixtureId: string,
): VisualBenchmarkFixtureMetadata => ({
  version: 4,
  mode: "storybook_component",
  fixtureId,
  capturedAt: "2026-04-01T00:00:00.000Z",
  source: {
    fileKey: "test",
    nodeId: "12:34",
    nodeName: "Storybook Components",
    lastModified: "2026-04-01T00:00:00.000Z",
  },
  viewport: { width: 200, height: 160 },
  export: { format: "png", scale: 1 },
  screens: [
    {
      screenId: "button-primary",
      screenName: "Button",
      storyTitle: "Button / Primary",
      nodeId: "12:34",
      viewport: { width: 200, height: 160 },
      entryId: "components-button--primary",
      referenceNodeId: "12:34",
      referenceFileKey: "test",
      captureStrategy: "storybook_root_union",
      baselineCanvas: { width: 120, height: 96 },
      viewports: [{ id: "desktop", width: 200, height: 160 }],
    },
  ],
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

const writeVisualQualityConfig = async (
  fixtureRoot: string,
  config: Record<string, unknown>,
): Promise<void> => {
  await writeFile(
    path.join(fixtureRoot, "visual-quality.config.json"),
    JSON.stringify(config, null, 2),
    "utf8",
  );
};

const upgradeFixtureToMultiScreen = async (
  fixtureId: string,
  env: { fixtureRoot: string; artifactRoot: string },
): Promise<void> => {
  await writeVisualBenchmarkFixtureMetadata(
    fixtureId,
    createMultiScreenFixtureMetadata(fixtureId),
    env,
  );
  await mkdir(
    path.dirname(
      resolveVisualBenchmarkScreenPaths(fixtureId, "2:10001", env).referencePngPath,
    ),
    { recursive: true },
  );
  await mkdir(
    path.dirname(
      resolveVisualBenchmarkScreenPaths(fixtureId, "2:10002", env).referencePngPath,
    ),
    { recursive: true },
  );
  await writeFile(
    resolveVisualBenchmarkScreenPaths(fixtureId, "2:10001", env).referencePngPath,
    createTestPngBuffer(8, 8, [0, 100, 200, 255]),
  );
  await writeFile(
    resolveVisualBenchmarkScreenPaths(fixtureId, "2:10002", env).referencePngPath,
    createTestPngBuffer(8, 8, [0, 100, 200, 255]),
  );
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

test("parseVisualBaselineCliArgs parses approve with --fixture only", () => {
  const result = parseVisualBaselineCliArgs(["approve", "--fixture", "simple-form"]);
  assert.deepEqual(result, { command: "approve", fixture: "simple-form", screen: undefined, json: false });
});

test("parseVisualBaselineCliArgs parses approve with --fixture and --screen", () => {
  const result = parseVisualBaselineCliArgs(["approve", "--fixture", "simple-form", "--screen", "2:10001"]);
  assert.deepEqual(result, { command: "approve", fixture: "simple-form", screen: "2:10001", json: false });
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

test("parseVisualBaselineCliArgs throws when approve missing --fixture", () => {
  assert.throws(() => parseVisualBaselineCliArgs(["approve"]), /--fixture <id> is required/);
});

test("parseVisualBaselineCliArgs throws when --screen is used without --fixture", () => {
  assert.throws(
    () => parseVisualBaselineCliArgs(["status", "--screen", "2:10001"]),
    /--fixture <id> is required when using --screen/,
  );
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
    assert.equal(baseline.version, 3);
    assert.deepEqual(baseline.scores, [
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        score: 92,
      },
    ]);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.ok(lastRun !== null);
    assert.deepEqual(lastRun.scores, [
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        score: 92,
      },
    ]);

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
      {
        fixtureId: "complex-dashboard",
        screenId: "1:1",
        screenName: "complex-dashboard",
        score: 90,
      },
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        score: 95,
      },
    ]);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.ok(lastRun !== null);
    assert.deepEqual(lastRun.scores, [
      {
        fixtureId: "complex-dashboard",
        screenId: "1:1",
        screenName: "complex-dashboard",
        score: 88,
      },
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        score: 95,
      },
    ]);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines merges replacement scores by fixture and screen identity", async () => {
  const env = await createFixtureEnvironment({
    fixtureIds: ["simple-form"],
    baselineScores: [
      { fixtureId: "simple-form", screenId: "1:1", screenName: "Main", score: 85 },
      { fixtureId: "simple-form", screenId: "2:2", screenName: "Secondary", score: 80 },
    ],
    lastRunScores: [
      { fixtureId: "simple-form", screenId: "1:1", screenName: "Main", score: 84 },
      { fixtureId: "simple-form", screenId: "2:2", screenName: "Secondary", score: 79 },
    ],
  });
  const runAt = new Date("2026-04-09T12:00:00.000Z");

  try {
    await updateVisualBaselines({
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

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [
      { fixtureId: "simple-form", screenId: "1:1", screenName: "simple-form", score: 95 },
      { fixtureId: "simple-form", screenId: "2:2", screenName: "Secondary", score: 80 },
    ]);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.ok(lastRun !== null);
    assert.deepEqual(lastRun.scores, [
      { fixtureId: "simple-form", screenId: "1:1", screenName: "simple-form", score: 95 },
      { fixtureId: "simple-form", screenId: "2:2", screenName: "Secondary", score: 79 },
    ]);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines appends bounded history using regression historySize", async () => {
  const env = await createFixtureEnvironment();
  const runAt = new Date("2026-04-09T12:00:00.000Z");

  try {
    await writeVisualQualityConfig(env.fixtureRoot, {
      regression: { historySize: 1 },
    });
    await saveVisualBenchmarkHistory(
      {
        version: 2,
        entries: [
          {
            runAt: "2026-04-08T12:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: "1:1",
                screenName: "simple-form",
                score: 88,
              },
            ],
          },
        ],
      },
      env,
    );

    await updateVisualBaselines({
      ...env,
      log: () => {},
      now: () => runAt,
      executeFixture: async (fixtureId) => ({
        fixtureId,
        score: 92,
        screenshotBuffer: createTestPngBuffer(8, 8, [255, 0, 0, 255]),
        diffBuffer: createTestPngBuffer(8, 8, [0, 255, 0, 255]),
        report: { fixtureId, outcome: "ok" },
        viewport: { width: 1440, height: 900 },
      }),
    });

    const history = await loadVisualBenchmarkHistory(env);
    assert.ok(history !== null);
    assert.deepEqual(history.entries, [
      {
        runAt: runAt.toISOString(),
        scores: [
          {
            fixtureId: "simple-form",
            screenId: "1:1",
            screenName: "simple-form",
            score: 92,
          },
        ],
      },
    ]);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines writes per-screen references and scores for multi-screen fixtures", async () => {
  const env = await createFixtureEnvironment();
  const runAt = new Date("2026-04-09T12:00:00.000Z");
  await upgradeFixtureToMultiScreen("simple-form", env);
  const homeBuffer = createTestPngBuffer(8, 8, [255, 0, 0, 255]);
  const settingsBuffer = createTestPngBuffer(8, 8, [0, 0, 255, 255]);

  try {
    await updateVisualBaselines({
      ...env,
      fixtureId: "simple-form",
      now: () => runAt,
      log: () => {},
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 86,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            nodeId: "2:10001",
            score: 90,
            screenshotBuffer: homeBuffer,
            diffBuffer: createTestPngBuffer(8, 8, [20, 20, 20, 255]),
            report: { status: "completed", overallScore: 90 },
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            nodeId: "2:10002",
            score: 78,
            screenshotBuffer: settingsBuffer,
            diffBuffer: createTestPngBuffer(8, 8, [40, 40, 40, 255]),
            report: { status: "completed", overallScore: 78 },
            viewport: { width: 1440, height: 900 },
          },
        ],
      }),
    });

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [
      {
        fixtureId: "simple-form",
        screenId: "2:10001",
        screenName: "Home",
        score: 90,
      },
      {
        fixtureId: "simple-form",
        screenId: "2:10002",
        screenName: "Settings",
        score: 78,
      },
    ]);

    const homeReference = await readFile(
      resolveVisualBenchmarkScreenPaths("simple-form", "2:10001", env)
        .referencePngPath,
    );
    const settingsReference = await readFile(
      resolveVisualBenchmarkScreenPaths("simple-form", "2:10002", env)
        .referencePngPath,
    );
    assert.deepEqual(homeReference, homeBuffer);
    assert.deepEqual(settingsReference, settingsBuffer);

    const homeArtifact = await loadVisualBenchmarkLastRunArtifact(
      "simple-form",
      "2:10001",
      env,
    );
    const settingsArtifact = await loadVisualBenchmarkLastRunArtifact(
      "simple-form",
      "2:10002",
      env,
    );
    assert.equal(homeArtifact?.score, 90);
    assert.equal(settingsArtifact?.score, 78);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines persists per-viewport references and artifact manifests for a single-screen fixture", async () => {
  const env = await createFixtureEnvironment();
  const runAt = new Date("2026-04-09T12:00:00.000Z");
  const desktopBuffer = createTestPngBuffer(8, 8, [255, 0, 0, 255]);
  const mobileBuffer = createTestPngBuffer(8, 8, [0, 255, 0, 255]);

  try {
    await updateVisualBaselines({
      ...env,
      fixtureId: "simple-form",
      now: () => runAt,
      log: () => {},
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 84,
        screens: [
          {
            screenId: "1:1",
            screenName: "simple-form",
            nodeId: "1:1",
            score: 84,
            screenshotBuffer: desktopBuffer,
            diffBuffer: createTestPngBuffer(8, 8, [20, 20, 20, 255]),
            report: { status: "completed", overallScore: 84 },
            viewport: { width: 1280, height: 720 },
            viewports: [
              {
                viewportId: "desktop",
                viewportLabel: "Desktop",
                score: 92,
                screenshotBuffer: desktopBuffer,
                diffBuffer: createTestPngBuffer(8, 8, [10, 10, 10, 255]),
                report: { status: "completed", overallScore: 92 },
                viewport: { width: 1280, height: 800 },
              },
              {
                viewportId: "mobile",
                viewportLabel: "Mobile",
                score: 76,
                screenshotBuffer: mobileBuffer,
                diffBuffer: createTestPngBuffer(8, 8, [30, 30, 30, 255]),
                report: { status: "completed", overallScore: 76 },
                viewport: { width: 390, height: 844 },
              },
            ],
          },
        ],
      }),
    });

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        viewportId: "desktop",
        viewportLabel: "Desktop",
        score: 92,
      },
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        viewportId: "mobile",
        viewportLabel: "Mobile",
        score: 76,
      },
    ]);

    const desktopReference = await readFile(
      path.join(
        env.fixtureRoot,
        "simple-form",
        "screens",
        "1_1",
        "desktop.png",
      ),
    );
    const mobileReference = await readFile(
      path.join(
        env.fixtureRoot,
        "simple-form",
        "screens",
        "1_1",
        "mobile.png",
      ),
    );
    assert.deepEqual(desktopReference, desktopBuffer);
    assert.deepEqual(mobileReference, mobileBuffer);

    const artifacts = await loadVisualBenchmarkLastRunArtifacts(
      "simple-form",
      "1:1",
      env,
    );
    assert.equal(artifacts.length, 2);
    assert.deepEqual(
      artifacts.map((artifact) => artifact.viewportId),
      ["desktop", "mobile"],
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("updateVisualBaselines tolerates skipped storybook component screens without overwriting baseline state", async () => {
  const env = await createFixtureEnvironment({
    fixtureIds: ["storybook-components"],
    baselineScores: [
      {
        fixtureId: "storybook-components",
        screenId: "button-primary",
        screenName: "Button / Primary",
        viewportId: "desktop",
        viewportLabel: "desktop",
        score: 88,
      },
    ],
    lastRunScores: [
      {
        fixtureId: "storybook-components",
        screenId: "button-primary",
        screenName: "Button / Primary",
        viewportId: "desktop",
        viewportLabel: "desktop",
        score: 88,
      },
    ],
  });

  try {
    await writeVisualBenchmarkFixtureMetadata(
      "storybook-components",
      createStorybookComponentFixtureMetadata("storybook-components"),
      env,
    );

    const result = await updateVisualBaselines({
      ...env,
      fixtureId: "storybook-components",
      log: () => undefined,
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 0,
        componentCoverage: {
          comparedCount: 0,
          skippedCount: 1,
          coveragePercent: 0,
          bySkipReason: { incomplete_mapping: 1 },
        },
        screens: [
          {
            screenId: "button-primary",
            screenName: "Button / Primary",
            nodeId: "12:34",
            status: "skipped" as const,
            skipReason: "incomplete_mapping",
            warnings: ["missing entryId"],
            score: 0,
            screenshotBuffer: createTestPngBuffer(1, 1, [0, 0, 0, 0]),
            diffBuffer: null,
            report: { status: "not_requested" },
            viewport: { width: 120, height: 96 },
          },
        ],
      }),
    });

    assert.equal(result.scores.length, 0);
    assert.equal(result.artifacts.length, 0);

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.equal(baseline?.scores.length, 1);
    assert.equal(baseline?.scores[0]?.score, 88);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.equal(lastRun?.scores.length, 1);
    assert.equal(lastRun?.scores[0]?.score, 88);
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
    assert.deepEqual(baseline.scores, [
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
        score: 95,
      },
    ]);

    const metadata = await loadVisualBenchmarkFixtureMetadata("simple-form", env);
    assert.equal(metadata.capturedAt, artifactTime);
    assert.deepEqual(metadata.viewport, { width: 1366, height: 768 });

    const reference = await loadVisualBenchmarkReference("simple-form", env);
    assert.deepEqual(reference, actualBuffer);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("approveVisualBaseline appends history using regression historySize", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 90 }],
  });
  const actualBuffer = createTestPngBuffer(8, 8, [200, 10, 10, 255]);

  try {
    await writeVisualQualityConfig(env.fixtureRoot, {
      regression: { historySize: 2 },
    });
    await saveVisualBenchmarkHistory(
      {
        version: 2,
        entries: [
          {
            runAt: "2026-04-07T15:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: "1:1",
                screenName: "simple-form",
                score: 80,
              },
            ],
          },
          {
            runAt: "2026-04-08T15:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: "1:1",
                screenName: "simple-form",
                score: 85,
              },
            ],
          },
        ],
      },
      env,
    );
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        score: 95,
        ranAt: "2026-04-09T15:00:00.000Z",
        viewport: { width: 1366, height: 768 },
        actualImageBuffer: actualBuffer,
        diffImageBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
        report: { approved: true },
      },
      env,
    );

    await approveVisualBaseline("simple-form", env);

    const history = await loadVisualBenchmarkHistory(env);
    assert.ok(history !== null);
    assert.deepEqual(history.entries, [
      {
        runAt: "2026-04-08T15:00:00.000Z",
        scores: [
          {
            fixtureId: "simple-form",
            screenId: "1:1",
            screenName: "simple-form",
            score: 85,
          },
        ],
      },
      {
        runAt: "2026-04-09T15:00:00.000Z",
        scores: [
          {
            fixtureId: "simple-form",
            screenId: "1:1",
            screenName: "simple-form",
            score: 95,
          },
        ],
      },
    ]);
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

test("approveVisualBaseline supports targeting a single screen in a multi-screen fixture", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [
      { fixtureId: "simple-form", screenId: "2:10001", screenName: "Home", score: 80 },
      { fixtureId: "simple-form", screenId: "2:10002", screenName: "Settings", score: 81 },
    ],
  });
  await upgradeFixtureToMultiScreen("simple-form", env);
  const homeBuffer = createTestPngBuffer(8, 8, [200, 10, 10, 255]);
  const settingsBuffer = createTestPngBuffer(8, 8, [10, 10, 200, 255]);

  try {
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        screenId: "2:10001",
        screenName: "Home",
        score: 90,
        ranAt: "2026-04-09T15:00:00.000Z",
        viewport: { width: 1280, height: 720 },
        actualImageBuffer: homeBuffer,
        diffImageBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
        report: { approved: true },
      },
      env,
    );
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        screenId: "2:10002",
        screenName: "Settings",
        score: 95,
        ranAt: "2026-04-10T15:00:00.000Z",
        viewport: { width: 1440, height: 900 },
        actualImageBuffer: settingsBuffer,
        diffImageBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
        report: { approved: true },
      },
      env,
    );

    const result = await approveVisualBaseline(
      { fixtureId: "simple-form", screenId: "2:10002" },
      env,
    );
    assert.equal(result.approvals.length, 1);
    assert.equal(result.screenId, "2:10002");
    assert.equal(result.newScore, 95);

    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.ok(baseline !== null);
    assert.deepEqual(baseline.scores, [
      { fixtureId: "simple-form", screenId: "2:10001", screenName: "Home", score: 80 },
      { fixtureId: "simple-form", screenId: "2:10002", screenName: "Settings", score: 95 },
    ]);
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
    assert.equal(entry.screenId, "1:1");
    assert.equal(entry.screenName, "simple-form");
    assert.equal(entry.baselineScore, 90);
    assert.equal(entry.lastRunScore, 95);
    assert.equal(entry.hasPendingDiff, true);
    assert.equal(entry.indicator, "improved");
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
    assert.equal(entry.screenId, "1:1");
    assert.equal(entry.screenName, "simple-form");
    assert.equal(entry.baselineScore, null);
    assert.equal(entry.lastRunScore, null);
    assert.equal(entry.hasPendingDiff, false);
    assert.equal(entry.indicator, "unavailable");
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
    assert.equal(entry.screenId, "1:1");
    assert.equal(entry.screenName, "simple-form");
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

test("computeVisualBaselineDiff resolves legacy last-run entries to metadata screen IDs", async () => {
  const env = await createFixtureEnvironment();

  try {
    await writeVisualBenchmarkFixtureMetadata(
      "simple-form",
      {
        ...createFixtureMetadata("simple-form"),
        source: {
          ...createFixtureMetadata("simple-form").source,
          nodeId: "2:7777",
          nodeName: "Simple Form",
        },
      },
      env,
    );

    await saveVisualBenchmarkBaselineScores(
      [{ fixtureId: "simple-form", score: 90 }],
      env,
    );

    await mkdir(env.artifactRoot, { recursive: true });
    await writeFile(
      path.join(env.artifactRoot, "last-run.json"),
      JSON.stringify(
        {
          version: 1,
          ranAt: "2026-04-09T12:00:00.000Z",
          scores: [{ fixtureId: "simple-form", score: 95 }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const diff = await computeVisualBaselineDiff(env);
    assert.equal(diff.diffs[0]?.screenId, "2:7777");
    assert.equal(diff.diffs[0]?.screenName, "Simple Form");
    assert.equal(diff.diffs[0]?.baseline, 90);
    assert.equal(diff.diffs[0]?.indicator, "improved");
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

test("computeVisualBaselineStatus uses configured regression neutralTolerance", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 100 }],
  });

  try {
    await writeVisualQualityConfig(env.fixtureRoot, {
      regression: { neutralTolerance: 0.5 },
    });
    await saveVisualBenchmarkLastRunArtifact(
      {
        fixtureId: "simple-form",
        score: 100.9,
        ranAt: "2026-04-09T12:00:00.000Z",
        viewport: { width: 1280, height: 720 },
        actualImageBuffer: createTestPngBuffer(8, 8, [255, 0, 0, 255]),
        diffImageBuffer: createTestPngBuffer(8, 8, [0, 255, 0, 255]),
        report: { diff: true },
      },
      env,
    );

    const status = await computeVisualBaselineStatus(env);
    assert.equal(status.entries[0]?.indicator, "improved");
    assert.equal(status.entries[0]?.hasPendingDiff, true);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("computeVisualBaselineDiff uses configured regression neutralTolerance", async () => {
  const env = await createFixtureEnvironment({
    baselineScores: [{ fixtureId: "simple-form", score: 100 }],
    lastRunScores: [{ fixtureId: "simple-form", score: 100.9 }],
  });

  try {
    await writeVisualQualityConfig(env.fixtureRoot, {
      regression: { neutralTolerance: 0.5 },
    });

    const diff = await computeVisualBaselineDiff(env);
    assert.equal(diff.diffs[0]?.indicator, "improved");
    assert.equal(diff.hasPendingDiffs, true);
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
        screenId: "1:1",
        screenName: "simple-form",
        baselineScore: 90,
        lastRunScore: 95,
        hasPendingDiff: true,
        indicator: "improved",
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
  assert.ok(table.includes("View"));
  assert.ok(table.includes("Captured"));
  assert.ok(table.includes("Age"));
  assert.ok(table.includes("Simple Form"));
});

test("formatVisualBaselineDiffTable produces a table with run date column", () => {
  const diffResult: VisualBaselineDiffResult = {
    diffs: [
      {
        fixtureId: "simple-form",
        screenId: "1:1",
        screenName: "simple-form",
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
  assert.ok(table.includes("View"));
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
