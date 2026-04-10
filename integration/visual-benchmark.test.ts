import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { DEFAULT_SCORING_WEIGHTS } from "../src/job-engine/visual-scoring.js";
import {
  assertAllowedFixtureId,
  assertAllowedFixturePath,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureBundle,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureManifest,
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  toStableJsonString,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
} from "./visual-benchmark.helpers.js";
import {
  fetchVisualBenchmarkNodeSnapshot,
  fetchVisualBenchmarkReferenceImage,
  resolveVisualBenchmarkMaintenanceMode,
  runVisualBenchmarkLiveAudit,
} from "./visual-benchmark.update.js";
import {
  resolveVisualBenchmarkCliResolution,
  runVisualBenchmarkCli,
} from "./visual-benchmark.cli.js";
import {
  computeVisualBenchmarkDeltas,
  computeVisualBenchmarkScores,
  formatVisualBenchmarkTable,
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRunArtifact,
  runVisualBenchmark,
  saveVisualBenchmarkBaseline,
  type VisualBenchmarkBaseline,
  type VisualBenchmarkResult,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";

const createTestPngBuffer = (
  width: number,
  height: number,
  rgba: readonly [number, number, number, number],
): Buffer => {
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
    fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
    nodeId: "1:65671",
    nodeName:
      "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
    lastModified: "2026-03-30T20:59:16Z",
  },
  viewport: {
    width: 1336,
    height: 1578,
  },
  export: {
    format: "png",
    scale: 2,
  },
};

const simpleFormManifest: VisualBenchmarkFixtureManifest = {
  version: 1,
  fixtureId: "simple-form",
  visualQuality: {
    frozenReferenceImage: "reference.png",
    frozenReferenceMetadata: "metadata.json",
  },
};

const createFixtureRoot = async (): Promise<string> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-"),
  );
  const fixtureDir = path.join(root, "simple-form");
  await mkdir(fixtureDir, { recursive: true });
  await writeVisualBenchmarkFixtureManifest("simple-form", simpleFormManifest, {
    fixtureRoot: root,
  });
  await writeVisualBenchmarkFixtureMetadata("simple-form", simpleFormMetadata, {
    fixtureRoot: root,
  });
  await writeVisualBenchmarkFixtureInputs(
    "simple-form",
    {
      name: "Simple-Test-Board",
      lastModified: "2026-03-30T20:59:16Z",
      nodes: {
        "1:65671": {
          document: {
            id: "1:65671",
            name: simpleFormMetadata.source.nodeName,
            type: "FRAME",
            absoluteBoundingBox: {
              x: 0,
              y: 0,
              width: simpleFormMetadata.viewport.width,
              height: simpleFormMetadata.viewport.height,
            },
          },
        },
      },
    },
    { fixtureRoot: root },
  );
  await writeVisualBenchmarkReference(
    "simple-form",
    createTestPngBuffer(8, 8, [0, 100, 200, 255]),
    { fixtureRoot: root },
  );
  return root;
};

const createBenchmarkFixtureEnvironment = async (
  metadataOverrides?: Partial<VisualBenchmarkFixtureMetadata>,
): Promise<{
  fixtureRoot: string;
  artifactRoot: string;
  metadata: VisualBenchmarkFixtureMetadata;
}> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-runner-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  const metadata: VisualBenchmarkFixtureMetadata = {
    ...simpleFormMetadata,
    ...metadataOverrides,
    source: {
      ...simpleFormMetadata.source,
      ...(metadataOverrides?.source ?? {}),
    },
    viewport: {
      ...simpleFormMetadata.viewport,
      ...(metadataOverrides?.viewport ?? {}),
    },
    export: {
      ...simpleFormMetadata.export,
      ...(metadataOverrides?.export ?? {}),
    },
  };

  await mkdir(path.join(fixtureRoot, metadata.fixtureId), { recursive: true });
  await writeVisualBenchmarkFixtureManifest(
    metadata.fixtureId,
    {
      ...simpleFormManifest,
      fixtureId: metadata.fixtureId,
    },
    { fixtureRoot, artifactRoot },
  );
  await writeVisualBenchmarkFixtureMetadata(metadata.fixtureId, metadata, {
    fixtureRoot,
    artifactRoot,
  });
  await writeVisualBenchmarkFixtureInputs(
    metadata.fixtureId,
    {
      name: "Simple-Test-Board",
      lastModified: metadata.source.lastModified,
      nodes: {
        [metadata.source.nodeId]: {
          document: {
            id: metadata.source.nodeId,
            name: metadata.source.nodeName,
            type: "FRAME",
            absoluteBoundingBox: {
              x: 0,
              y: 0,
              width: metadata.viewport.width,
              height: metadata.viewport.height,
            },
          },
        },
      },
    },
    { fixtureRoot, artifactRoot },
  );
  await writeVisualBenchmarkReference(
    metadata.fixtureId,
    createTestPngBuffer(8, 8, [0, 100, 200, 255]),
    { fixtureRoot, artifactRoot },
  );

  return { fixtureRoot, artifactRoot, metadata };
};

const createCompletedVisualQualityReport = (overallScore = 87.5) => ({
  status: "completed" as const,
  referenceSource: "frozen_fixture" as const,
  capturedAt: "2026-04-09T00:00:00.000Z",
  overallScore,
  interpretation: "Good parity — small layout or color deviations",
  dimensions: [
    { name: "Layout Accuracy", weight: 0.3, score: 95, details: "" },
    { name: "Color Fidelity", weight: 0.25, score: 90, details: "" },
    { name: "Typography", weight: 0.2, score: 85, details: "" },
    { name: "Component Structure", weight: 0.15, score: 80, details: "" },
    { name: "Spacing & Alignment", weight: 0.1, score: 75, details: "" },
  ],
  diffImagePath: "visual-quality/diff.png",
  hotspots: [],
  metadata: {
    comparedAt: "2026-04-09T00:00:00.000Z",
    imageWidth: 1280,
    imageHeight: 720,
    totalPixels: 921600,
    diffPixelCount: 1024,
    configuredWeights: { ...DEFAULT_SCORING_WEIGHTS },
    viewport: {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
    },
    versions: {
      packageVersion: "1.0.0",
      contractVersion: "1.0.0",
    },
  },
});

const liveSnapshotPayload = {
  name: "Simple-Test-Board",
  lastModified: "2026-04-10T09:15:00Z",
  nodes: {
    "1:65671": {
      document: {
        id: "1:65671",
        name: "Updated Simple Form",
        type: "FRAME",
        absoluteBoundingBox: {
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        },
      },
    },
  },
};

const createJsonResponse = (value: unknown): Response => {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

test("listVisualBenchmarkFixtureIds returns at least one fixture", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  assert.ok(ids.length > 0, "Expected at least one visual-benchmark fixture.");
  assert.ok(
    ids.includes("simple-form"),
    "Expected 'simple-form' fixture to be present.",
  );
});

test("loadVisualBenchmarkFixtureMetadata validates the committed simple-form fixture", async () => {
  const metadata = await loadVisualBenchmarkFixtureMetadata("simple-form");
  assert.equal(metadata.version, 1);
  assert.equal(metadata.fixtureId, "simple-form");
  assert.equal(metadata.source.fileKey, "DUArQ8VuM3aPMjXFLaQSSH");
  assert.equal(metadata.source.nodeId, "1:65671");
  assert.equal(metadata.export.format, "png");
  assert.ok(metadata.viewport.width > 0);
  assert.ok(metadata.viewport.height > 0);
});

test("loadVisualBenchmarkFixtureManifest validates the committed simple-form fixture", async () => {
  const manifest = await loadVisualBenchmarkFixtureManifest("simple-form");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.fixtureId, "simple-form");
  assert.equal(manifest.visualQuality.frozenReferenceImage, "reference.png");
  assert.equal(manifest.visualQuality.frozenReferenceMetadata, "metadata.json");
});

test("loadVisualBenchmarkFixtureInputs reads figma.json for simple-form", async () => {
  const figmaInput = await loadVisualBenchmarkFixtureInputs("simple-form");
  assert.ok(
    typeof figmaInput === "object" && figmaInput !== null,
    "Expected figmaInput to be an object.",
  );
  const nodes = (figmaInput as Record<string, unknown>).nodes;
  assert.ok(
    typeof nodes === "object" && nodes !== null,
    "Expected figmaInput.nodes to be an object.",
  );
  assert.ok(
    Object.hasOwn(nodes as Record<string, unknown>, "1:65671"),
    "Expected live node id to be present.",
  );
});

test("loadVisualBenchmarkReference reads a valid PNG for the committed fixture", async () => {
  const buffer = await loadVisualBenchmarkReference("simple-form");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.ok(isValidPngBuffer(buffer));
});

test("loadVisualBenchmarkFixtureBundle loads the flat fixture bundle", async () => {
  const bundle = await loadVisualBenchmarkFixtureBundle("simple-form");
  assert.equal(bundle.manifest.fixtureId, "simple-form");
  assert.equal(bundle.metadata.fixtureId, "simple-form");
  assert.ok(
    typeof bundle.figmaInput === "object" && bundle.figmaInput !== null,
  );
  assert.ok(bundle.referenceBuffer.length > 0);
});

test("assertAllowedFixtureId and assertAllowedFixturePath reject invalid inputs", () => {
  assert.throws(() => assertAllowedFixturePath(""), {
    message: "Fixture path must not be empty.",
  });
  assert.throws(() => assertAllowedFixturePath("/absolute/path"), {
    message: /must be relative/,
  });
  assert.throws(() => assertAllowedFixturePath("../escape/path"), {
    message: /contains forbidden segment/,
  });
  assert.throws(() => assertAllowedFixturePath("path/with/../traversal"), {
    message: /contains forbidden segment/,
  });
  assert.throws(() => assertAllowedFixturePath("path/to/file.zip"), {
    message: /contains forbidden segment/,
  });
  assert.throws(() => assertAllowedFixturePath("storybook-static/thing"), {
    message: /contains forbidden segment/,
  });
  assert.throws(() => assertAllowedFixtureId("nested/fixture"), {
    message: /must not contain path separators/,
  });

  assert.equal(assertAllowedFixtureId("simple-form"), "simple-form");
  assert.equal(
    assertAllowedFixturePath("inputs/figma.json"),
    "inputs/figma.json",
  );
});

test("fetchVisualBenchmarkNodeSnapshot uses the node-scoped Figma endpoint", async () => {
  const requestedUrls: string[] = [];
  const snapshot = await fetchVisualBenchmarkNodeSnapshot(
    simpleFormMetadata,
    "test-token",
    {
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return createJsonResponse(liveSnapshotPayload);
      },
    },
  );

  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /\/files\/DUArQ8VuM3aPMjXFLaQSSH\/nodes\?/);
  assert.match(requestedUrls[0], /ids=1%3A65671/);
  assert.match(requestedUrls[0], /geometry=paths/);
  assert.equal(snapshot.nodeName, "Updated Simple Form");
  assert.equal(snapshot.lastModified, "2026-04-10T09:15:00Z");
  assert.deepEqual(snapshot.viewport, { width: 1440, height: 900 });
});

test("fetchVisualBenchmarkReferenceImage fails when Figma returns no renderable image", async () => {
  await assert.rejects(async () => {
    await fetchVisualBenchmarkReferenceImage(simpleFormMetadata, "test-token", {
      fetchImpl: async () =>
        createJsonResponse({
          err: null,
          images: {
            "1:65671": null,
          },
        }),
    });
  }, /no renderable image/);
});

test("fetchVisualBenchmarkReferenceImage fails when the downloaded asset is not a PNG", async () => {
  let callIndex = 0;
  await assert.rejects(async () => {
    await fetchVisualBenchmarkReferenceImage(simpleFormMetadata, "test-token", {
      fetchImpl: async () => {
        callIndex += 1;
        if (callIndex === 1) {
          return createJsonResponse({
            err: null,
            images: {
              "1:65671": "https://example.test/reference.png",
            },
          });
        }
        return new Response("not-a-png", { status: 200 });
      },
    });
  }, /invalid PNG/);
});

test("runVisualBenchmarkLiveAudit detects JSON and PNG drift", async () => {
  const fixtureRoot = await createFixtureRoot();
  process.env.FIGMA_ACCESS_TOKEN = "test-token";
  let fetchCall = 0;

  try {
    const results = await runVisualBenchmarkLiveAudit({
      fixtureRoot,
      fetchImpl: async () => {
        fetchCall += 1;
        if (fetchCall === 1) {
          return createJsonResponse(liveSnapshotPayload);
        }
        if (fetchCall === 2) {
          return createJsonResponse({
            err: null,
            images: {
              "1:65671": "https://example.test/reference.png",
            },
          });
        }
        return new Response(createTestPngBuffer(8, 8, [255, 0, 0, 255]), {
          status: 200,
        });
      },
      log: () => {
        return;
      },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.fixtureId, "simple-form");
    assert.equal(results[0]?.figmaChanged, true);
    assert.equal(results[0]?.referenceChanged, true);
    assert.equal(results[0]?.frozenLastModified, "2026-03-30T20:59:16Z");
    assert.equal(results[0]?.liveLastModified, "2026-04-10T09:15:00Z");
  } finally {
    delete process.env.FIGMA_ACCESS_TOKEN;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resolveVisualBenchmarkMaintenanceMode accepts exactly one maintenance flag", () => {
  assert.equal(
    resolveVisualBenchmarkMaintenanceMode(["--update-fixtures"]),
    "update-fixtures",
  );
  assert.equal(
    resolveVisualBenchmarkMaintenanceMode(["--update-references"]),
    "update-references",
  );
  assert.equal(resolveVisualBenchmarkMaintenanceMode(["--live"]), "live");
  assert.throws(
    () => resolveVisualBenchmarkMaintenanceMode([]),
    /Usage: visual-benchmark.update.ts/,
  );
  assert.throws(
    () =>
      resolveVisualBenchmarkMaintenanceMode(["--update-fixtures", "--live"]),
    /Usage: visual-benchmark.update.ts/,
  );
});

test("resolveVisualBenchmarkCliResolution routes default mode to benchmark and flags to maintenance", () => {
  const defaultResult = resolveVisualBenchmarkCliResolution([]);
  assert.equal(defaultResult.action, "benchmark");
  assert.deepEqual(defaultResult.forwardedArgs, []);
  assert.equal(defaultResult.qualityThreshold, undefined);

  const maintenanceResult = resolveVisualBenchmarkCliResolution([
    "--update-fixtures",
  ]);
  assert.equal(maintenanceResult.action, "maintenance");
  assert.deepEqual(maintenanceResult.forwardedArgs, ["--update-fixtures"]);
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--invalid"]),
    /Usage: pnpm benchmark:visual/,
  );
});

test("runVisualBenchmarkCli runs the benchmark runner in default mode", async () => {
  let calls = 0;
  const status = await runVisualBenchmarkCli([], {
    runBenchmark: async () => {
      calls += 1;
      return {
        deltas: [],
        overallBaseline: null,
        overallCurrent: 0,
        overallDelta: null,
      };
    },
  });

  assert.equal(status, 0);
  assert.equal(calls, 1);
});

test("helper store writes stable fixture JSON in sorted key order", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-stable-"),
  );
  try {
    await mkdir(path.join(fixtureRoot, "stable"), { recursive: true });
    await writeVisualBenchmarkFixtureInputs(
      "stable",
      {
        zeta: 1,
        alpha: {
          beta: 2,
          aardvark: 1,
        },
      },
      { fixtureRoot },
    );

    const stored = await loadVisualBenchmarkFixtureInputs("stable", {
      fixtureRoot,
    });
    assert.equal(
      toStableJsonString(stored),
      '{\n  "alpha": {\n    "aardvark": 1,\n    "beta": 2\n  },\n  "zeta": 1\n}\n',
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("listVisualBenchmarkFixtureIds returns all 5 fixture IDs", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  assert.ok(ids.includes("simple-form"), "Expected 'simple-form' fixture.");
  assert.ok(
    ids.includes("complex-dashboard"),
    "Expected 'complex-dashboard' fixture.",
  );
  assert.ok(ids.includes("data-table"), "Expected 'data-table' fixture.");
  assert.ok(
    ids.includes("navigation-sidebar"),
    "Expected 'navigation-sidebar' fixture.",
  );
  assert.ok(
    ids.includes("design-system-showcase"),
    "Expected 'design-system-showcase' fixture.",
  );
  assert.equal(ids.length, 5, "Expected exactly 5 fixture IDs.");
});

test("all 5 fixtures can be loaded (manifest, metadata, figma.json, reference.png)", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  for (const id of ids) {
    const manifest = await loadVisualBenchmarkFixtureManifest(id);
    const metadata = await loadVisualBenchmarkFixtureMetadata(id);
    assert.equal(manifest.fixtureId, id);
    assert.equal(manifest.visualQuality.frozenReferenceImage, "reference.png");
    assert.equal(
      manifest.visualQuality.frozenReferenceMetadata,
      "metadata.json",
    );
    assert.equal(metadata.version, 1);
    assert.equal(metadata.fixtureId, id);
    assert.equal(metadata.source.fileKey, "DUArQ8VuM3aPMjXFLaQSSH");
    assert.ok(metadata.viewport.width > 0);
    assert.ok(metadata.viewport.height > 0);

    const figmaInput = await loadVisualBenchmarkFixtureInputs(id);
    assert.ok(
      typeof figmaInput === "object" && figmaInput !== null,
      `Expected figmaInput for '${id}' to be an object.`,
    );

    const reference = await loadVisualBenchmarkReference(id);
    assert.ok(Buffer.isBuffer(reference));
    assert.ok(isValidPngBuffer(reference), `Expected valid PNG for '${id}'.`);
  }
});

test("computeVisualBenchmarkScores returns a score for each fixture", async () => {
  const scores = await computeVisualBenchmarkScores(undefined, {
    runFixtureBenchmark: async (fixtureId) => ({
      fixtureId,
      score: fixtureId === "simple-form" ? 91 : 90,
    }),
  });
  assert.equal(scores.length, 5, "Expected scores for all 5 fixtures.");
  for (const entry of scores) {
    assert.ok(
      typeof entry.fixtureId === "string" && entry.fixtureId.length > 0,
    );
    assert.ok(
      typeof entry.screenId === "string" && entry.screenId.length > 0,
      `Expected screen identity for '${entry.fixtureId}'.`,
    );
    assert.ok(
      entry.score >= 90,
      `Expected stubbed score for '${entry.fixtureId}'.`,
    );
  }
});

test("computeVisualBenchmarkDeltas with baseline computes correct deltas per fixture and screen", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", screenId: "screen-a", screenName: "Screen A", score: 95 },
    { fixtureId: "fixture-a", screenId: "screen-b", screenName: "Screen B", score: 80 },
    { fixtureId: "fixture-c", screenId: "screen-c", screenName: "Screen C", score: 100 },
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: [
      { fixtureId: "fixture-a", screenId: "screen-a", screenName: "Screen A", score: 90 },
      { fixtureId: "fixture-a", screenId: "screen-b", screenName: "Screen B", score: 85 },
      { fixtureId: "fixture-c", screenId: "screen-c", screenName: "Screen C", score: 100 },
    ],
  };
  const result = computeVisualBenchmarkDeltas(current, baseline);
  assert.equal(result.deltas.length, 3);

  const deltaA = result.deltas.find(
    (d) => d.fixtureId === "fixture-a" && d.screenId === "screen-a",
  );
  assert.ok(deltaA);
  assert.equal(deltaA.baseline, 90);
  assert.equal(deltaA.current, 95);
  assert.equal(deltaA.delta, 5);
  assert.equal(deltaA.indicator, "improved");
  assert.equal(deltaA.screenName, "Screen A");

  const deltaB = result.deltas.find(
    (d) => d.fixtureId === "fixture-a" && d.screenId === "screen-b",
  );
  assert.ok(deltaB);
  assert.equal(deltaB.baseline, 85);
  assert.equal(deltaB.current, 80);
  assert.equal(deltaB.delta, -5);
  assert.equal(deltaB.indicator, "degraded");

  const deltaC = result.deltas.find(
    (d) => d.fixtureId === "fixture-c" && d.screenId === "screen-c",
  );
  assert.ok(deltaC);
  assert.equal(deltaC.baseline, 100);
  assert.equal(deltaC.current, 100);
  assert.equal(deltaC.delta, 0);
  assert.equal(deltaC.indicator, "neutral");
});

test("computeVisualBenchmarkDeltas with null baseline returns null deltas", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", screenId: "screen-a", screenName: "Screen A", score: 88 },
  ];
  const result = computeVisualBenchmarkDeltas(current, null);
  assert.equal(result.deltas.length, 1);
  assert.equal(result.deltas[0]?.baseline, null);
  assert.equal(result.deltas[0]?.delta, null);
  assert.equal(result.deltas[0]?.indicator, "unavailable");
  assert.equal(result.deltas[0]?.screenId, "screen-a");
  assert.equal(result.overallBaseline, null);
  assert.equal(result.overallDelta, null);
  assert.equal(result.overallCurrent, 88);
});

test("computeVisualBenchmarkDeltas computes overallDelta from matched fixture pairs only", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", screenId: "screen-a", score: 100 },
    { fixtureId: "fixture-b", screenId: "screen-b", score: 50 },
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: [
      { fixtureId: "fixture-a", screenId: "screen-a", score: 80 },
      { fixtureId: "fixture-c", screenId: "screen-c", score: 90 },
    ],
  };

  const result = computeVisualBenchmarkDeltas(current, baseline);
  assert.equal(result.overallCurrent, 75);
  assert.equal(result.overallBaseline, 80);
  assert.equal(result.overallDelta, 20);
  assert.equal(
    result.deltas.find((d) => d.fixtureId === "fixture-b")?.indicator,
    "unavailable",
  );
});

test("computeVisualBenchmarkDeltas treats +/-1 deltas as neutral tolerance", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", screenId: "screen-a", score: 91 },
    { fixtureId: "fixture-b", screenId: "screen-b", score: 89 },
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: [
      { fixtureId: "fixture-a", screenId: "screen-a", score: 90 },
      { fixtureId: "fixture-b", screenId: "screen-b", score: 90 },
    ],
  };

  const result = computeVisualBenchmarkDeltas(current, baseline);
  assert.equal(result.deltas[0]?.delta, 1);
  assert.equal(result.deltas[0]?.indicator, "neutral");
  assert.equal(result.deltas[1]?.delta, -1);
  assert.equal(result.deltas[1]?.indicator, "neutral");
});

test("formatVisualBenchmarkTable produces a table with expected structure", () => {
  const result: VisualBenchmarkResult = {
    deltas: [
      {
        fixtureId: "simple-form",
        baseline: 85,
        current: 88,
        delta: 3,
        indicator: "improved",
      },
      {
        fixtureId: "complex-dashboard",
        baseline: null,
        current: 100,
        delta: null,
        indicator: "unavailable",
      },
    ],
    overallBaseline: 85,
    overallCurrent: 94,
    overallDelta: 3,
    alerts: [],
    trendSummaries: [],
  };
  const table = formatVisualBenchmarkTable(result);
  assert.ok(table.includes("View"), "Table should contain 'View' header.");
  assert.ok(
    table.includes("Baseline"),
    "Table should contain 'Baseline' header.",
  );
  assert.ok(
    table.includes("Current"),
    "Table should contain 'Current' header.",
  );
  assert.ok(table.includes("Delta"), "Table should contain 'Delta' header.");
  assert.ok(
    table.includes("Simple Form"),
    "Table should contain fixture display name.",
  );
  assert.ok(
    table.includes("Complex Dashboard"),
    "Table should contain fixture display name.",
  );
  assert.ok(
    table.includes("Overall Average"),
    "Table should contain overall row.",
  );
  assert.ok(table.includes("88"), "Table should contain current score.");
  assert.ok(table.includes("85"), "Table should contain baseline score.");
  assert.ok(
    table.includes("\u2014"),
    "Table should contain em-dash for null baseline.",
  );
  assert.ok(table.includes("n/a"), "Table should contain unavailable marker.");
});

test("computeVisualBenchmarkDeltas throws when current score list is empty", () => {
  assert.throws(
    () => computeVisualBenchmarkDeltas([], null),
    /Current visual benchmark scores must not be empty\./,
  );
});

test("loadVisualBenchmarkBaseline loads the committed baseline file", async () => {
  const baseline = await loadVisualBenchmarkBaseline();
  assert.ok(baseline !== null, "Expected baseline to exist.");
  assert.equal(baseline.version, 3);
  assert.equal(baseline.scores.length, 5);
  for (const entry of baseline.scores) {
    assert.equal(
      typeof entry.score,
      "number",
      `Expected numeric baseline score for '${entry.fixtureId}'.`,
    );
    assert.ok(
      Number.isFinite(entry.score),
      `Expected finite baseline score for '${entry.fixtureId}'.`,
    );
    assert.ok(
      typeof entry.screenId === "string" && entry.screenId.length > 0,
      `Expected screenId for '${entry.fixtureId}'.`,
    );
  }
});

test("saveVisualBenchmarkBaseline and loadVisualBenchmarkBaseline round-trip", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-baseline-"),
  );
  try {
    const result: VisualBenchmarkResult = {
      deltas: [
        {
          fixtureId: "test-fixture",
          baseline: null,
          current: 92,
          delta: null,
          indicator: "unavailable",
        },
      ],
      overallBaseline: null,
      overallCurrent: 92,
      overallDelta: null,
      alerts: [],
      trendSummaries: [],
    };
    await saveVisualBenchmarkBaseline(result, { fixtureRoot });

    const loaded = await loadVisualBenchmarkBaseline({ fixtureRoot });
    assert.ok(loaded !== null);
    assert.equal(loaded.version, 3);
    assert.equal(loaded.scores.length, 1);
    assert.equal(loaded.scores[0]?.fixtureId, "test-fixture");
    assert.equal(loaded.scores[0]?.screenId, "test-fixture");
    assert.equal(loaded.scores[0]?.score, 92);
    assert.equal(loaded.updatedAt, undefined);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkBaseline accepts legacy v1 baseline and save normalizes to v3 screen-scoped entries", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "legacy-fixture",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:7777",
      nodeName: "Legacy Fixture Screen",
    },
  });
  try {
    const baselinePath = path.join(env.fixtureRoot, "baseline.json");
    await writeFile(
      baselinePath,
      JSON.stringify(
        {
          version: 1,
          updatedAt: "2026-04-01T00:00:00.000Z",
          scores: [{ fixtureId: "legacy-fixture", score: 91 }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadVisualBenchmarkBaseline(env);
    assert.ok(loaded !== null);
    assert.equal(loaded.version, 3);
    assert.deepEqual(loaded.scores, [
      {
        fixtureId: "legacy-fixture",
        screenId: "2:7777",
        screenName: "Legacy Fixture Screen",
        score: 91,
      },
    ]);

    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "legacy-fixture",
            screenId: "2:7777",
            screenName: "Legacy Fixture Screen",
            baseline: 91,
            current: 94,
            delta: 3,
            indicator: "improved",
          },
        ],
        overallBaseline: 91,
        overallCurrent: 94,
        overallDelta: 3,
      },
      env,
    );

    const normalized = await loadVisualBenchmarkBaseline(env);
    assert.ok(normalized !== null);
    assert.equal(normalized.version, 3);
    assert.equal(normalized.updatedAt, undefined);
    assert.deepEqual(normalized.scores, [
      {
        fixtureId: "legacy-fixture",
        screenId: "2:7777",
        screenName: "Legacy Fixture Screen",
        score: 94,
      },
    ]);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkBaseline returns null when baseline file does not exist", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-nobaseline-"),
  );
  try {
    const baseline = await loadVisualBenchmarkBaseline({ fixtureRoot });
    assert.equal(baseline, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resolveVisualBenchmarkCliResolution accepts --update-baseline", () => {
  const result = resolveVisualBenchmarkCliResolution(["--update-baseline"]);
  assert.equal(result.action, "maintenance");
  assert.deepEqual(result.forwardedArgs, ["--update-baseline"]);
});

test("resolveVisualBenchmarkMaintenanceMode accepts --update-baseline", () => {
  assert.equal(
    resolveVisualBenchmarkMaintenanceMode(["--update-baseline"]),
    "update-baseline",
  );
});

test("runVisualBenchmark applies configured weights to execution results and persisted artifact reports", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  const customWeights = {
    layoutAccuracy: 0.1,
    colorFidelity: 0.1,
    typography: 0.1,
    componentStructure: 0.1,
    spacingAlignment: 0.6,
  };

  try {
    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          weights: customWeights,
        },
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          score: 87.5,
          screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
          diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
          report: createCompletedVisualQualityReport(),
          viewport: { width: 1280, height: 720 },
        }),
      },
    );

    assert.equal(result.deltas[0]?.current, 80);

    const persistedReport = JSON.parse(
      await readFile(
        path.join(env.artifactRoot, "last-run", "simple-form", "report.json"),
        "utf8",
      ),
    ) as {
      overallScore: number;
      dimensions: Array<{ weight: number }>;
      metadata: { configuredWeights: { spacingAlignment: number } };
    };

    assert.equal(persistedReport.overallScore, 80);
    assert.equal(persistedReport.dimensions[4]?.weight, 0.6);
    assert.equal(
      persistedReport.metadata.configuredWeights.spacingAlignment,
      0.6,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark applies screen-level thresholds using the fixture nodeId", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:2222",
      nodeName: "Fixture Screen",
    },
  });

  try {
    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          thresholds: { warn: 90, fail: 80 },
          fixtures: {
            "simple-form": {
              thresholds: { warn: 70, fail: 60 },
              screens: {
                "2:2222": {
                  thresholds: { warn: 55, fail: 45 },
                },
              },
            },
          },
        },
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          score: 50,
          screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
          diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
          report: null,
          viewport: { width: 1280, height: 720 },
        }),
      },
    );

    assert.deepEqual(result.deltas[0]?.thresholdResult?.thresholds, {
      warn: 55,
      fail: 45,
    });
    assert.equal(result.deltas[0]?.thresholdResult?.verdict, "warn");
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark applies screen-level thresholds using the fixture nodeName alias", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:3333",
      nodeName: "Marketing Page",
    },
  });

  try {
    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          thresholds: { warn: 90, fail: 80 },
          fixtures: {
            "simple-form": {
              thresholds: { warn: 70, fail: 60 },
              screens: {
                "Marketing Page": {
                  thresholds: { warn: 58, fail: 46 },
                },
              },
            },
          },
        },
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          score: 44,
          screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
          diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
          report: null,
          viewport: { width: 1280, height: 720 },
        }),
      },
    );

    assert.deepEqual(result.deltas[0]?.thresholdResult?.thresholds, {
      warn: 58,
      fail: 46,
    });
    assert.equal(result.deltas[0]?.thresholdResult?.verdict, "fail");
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("resolveVisualBenchmarkCliResolution accepts --ci flag", () => {
  const resolution = resolveVisualBenchmarkCliResolution(["--ci"]);
  assert.equal(resolution.action, "benchmark");
  assert.equal(resolution.ci, true);
  assert.deepEqual(resolution.forwardedArgs, []);
});

test("resolveVisualBenchmarkCliResolution accepts --ci with --quality-threshold", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--ci",
    "--quality-threshold",
    "75",
  ]);
  assert.equal(resolution.action, "benchmark");
  assert.equal(resolution.ci, true);
  assert.equal(resolution.qualityThreshold, 75);
});

test("resolveVisualBenchmarkCliResolution accepts --enforce-thresholds", () => {
  const resolution = resolveVisualBenchmarkCliResolution([
    "--ci",
    "--enforce-thresholds",
  ]);
  assert.equal(resolution.action, "benchmark");
  assert.equal(resolution.ci, true);
  assert.equal(resolution.enforceThresholds, true);
});

test("runVisualBenchmarkCli returns exit code 0 with --ci when any fixture fails threshold", async () => {
  const status = await runVisualBenchmarkCli(["--ci"], {
    runBenchmark: async () => ({
      deltas: [
        {
          fixtureId: "simple-form",
          baseline: 100,
          current: 50,
          delta: -50,
          indicator: "degraded" as const,
          thresholdResult: {
            score: 50,
            verdict: "fail" as const,
            thresholds: { warn: 80, fail: 60 },
          },
        },
      ],
      overallBaseline: 100,
      overallCurrent: 50,
      overallDelta: -50,
    }),
  });
  assert.equal(status, 0);
});

test("runVisualBenchmarkCli returns exit code 1 with --enforce-thresholds when any fixture fails threshold", async () => {
  const status = await runVisualBenchmarkCli(["--ci", "--enforce-thresholds"], {
    runBenchmark: async () => ({
      deltas: [
        {
          fixtureId: "simple-form",
          baseline: 100,
          current: 50,
          delta: -50,
          indicator: "degraded" as const,
          thresholdResult: {
            score: 50,
            verdict: "fail" as const,
            thresholds: { warn: 80, fail: 60 },
          },
        },
      ],
      overallBaseline: 100,
      overallCurrent: 50,
      overallDelta: -50,
    }),
  });
  assert.equal(status, 1);
});

test("runVisualBenchmarkCli returns exit code 0 with --ci when fixtures only warn", async () => {
  const status = await runVisualBenchmarkCli(["--ci"], {
    runBenchmark: async () => ({
      deltas: [
        {
          fixtureId: "simple-form",
          baseline: 100,
          current: 75,
          delta: -25,
          indicator: "degraded" as const,
          thresholdResult: {
            score: 75,
            verdict: "warn" as const,
            thresholds: { warn: 80, fail: 60 },
          },
        },
      ],
      overallBaseline: 100,
      overallCurrent: 75,
      overallDelta: -25,
    }),
  });
  assert.equal(status, 0);
});

test("runVisualBenchmarkCli returns exit code 0 without --ci even when fixtures fail threshold", async () => {
  const status = await runVisualBenchmarkCli([], {
    runBenchmark: async () => ({
      deltas: [
        {
          fixtureId: "simple-form",
          baseline: 100,
          current: 50,
          delta: -50,
          indicator: "degraded" as const,
          thresholdResult: {
            score: 50,
            verdict: "fail" as const,
            thresholds: { warn: 80, fail: 60 },
          },
        },
      ],
      overallBaseline: 100,
      overallCurrent: 50,
      overallDelta: -50,
    }),
  });
  assert.equal(status, 0);
});

test("runVisualBenchmarkCli returns exit code 0 with --ci when all fixtures pass", async () => {
  const status = await runVisualBenchmarkCli(["--ci"], {
    runBenchmark: async () => ({
      deltas: [
        {
          fixtureId: "simple-form",
          baseline: 100,
          current: 95,
          delta: -5,
          indicator: "neutral" as const,
          thresholdResult: {
            score: 95,
            verdict: "pass" as const,
            thresholds: { warn: 80, fail: 60 },
          },
        },
      ],
      overallBaseline: 100,
      overallCurrent: 95,
      overallDelta: -5,
    }),
  });
  assert.equal(status, 0);
});

test("runVisualBenchmark stores warn-only threshold results in the last-run artifact manifest", async () => {
  const env = await createBenchmarkFixtureEnvironment();

  try {
    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          thresholds: { warn: 90 },
        },
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          score: 75,
          screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
          diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
          report: createCompletedVisualQualityReport(75),
          viewport: { width: 1280, height: 720 },
        }),
      },
    );

    const artifact = await loadVisualBenchmarkLastRunArtifact(
      "simple-form",
      env,
    );
    assert.equal(result.deltas[0]?.thresholdResult?.verdict, "warn");
    assert.deepEqual(artifact?.thresholdResult, {
      score: 87.5,
      verdict: "warn",
      thresholds: { warn: 90 },
    });
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("visual benchmark workflow keeps PR mode non-blocking and updates the existing check run", async () => {
  const workflow = await readFile(
    path.join(process.cwd(), ".github", "workflows", "visual-benchmark.yml"),
    "utf8",
  );
  assert.match(workflow, /name:\s+benchmark/);
  assert.match(workflow, /pnpm benchmark:visual -- --ci/);
  assert.doesNotMatch(workflow, /--enforce-thresholds/);
  assert.doesNotMatch(workflow, /FIGMA_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /FIGMA_FILE_KEY/);
  assert.match(workflow, /actions\/github-script@v8/);
  assert.match(workflow, /check-output\.json/);
  assert.match(workflow, /github\.rest\.checks\.update/);
  assert.match(workflow, /scripts\/print-visual-benchmark-summary\.mjs/);
  assert.match(workflow, /scripts\/visual-benchmark-summary\.mjs/);
  assert.match(workflow, /scripts\/print-visual-benchmark-pr-comment\.mjs/);
  assert.doesNotMatch(
    workflow,
    /name:\s+Post or update visual benchmark PR comment/,
  );
});

test("visual benchmark comment workflow posts marker-based upserts from workflow_run artifacts", async () => {
  const workflow = await readFile(
    path.join(
      process.cwd(),
      ".github",
      "workflows",
      "visual-benchmark-comment.yml",
    ),
    "utf8",
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s+\['workspace-dev visual benchmark'\]/);
  assert.match(
    workflow,
    /if:\s+github\.event\.workflow_run\.event == 'pull_request'/,
  );
  assert.match(workflow, /listWorkflowRunArtifacts/);
  assert.match(workflow, /pr-comment\.json/);
  assert.match(workflow, /payload\.body\.startsWith\(payload\.marker\)/);
  assert.match(workflow, /github\.rest\.issues\.updateComment/);
  assert.match(workflow, /github\.rest\.issues\.createComment/);
});

// ---------------------------------------------------------------------------
// Issue #841 — Historical trend analysis, regression detection,
// and CLI trend output integration with runVisualBenchmark
// ---------------------------------------------------------------------------

test("runVisualBenchmark attaches trendSummaries matching deltas", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "simple-form",
            baseline: 90,
            current: 90,
            delta: 0,
            indicator: "neutral",
          },
        ],
        overallBaseline: 90,
        overallCurrent: 90,
        overallDelta: 0,
        alerts: [],
        trendSummaries: [],
      },
      env,
    );

    const result = await runVisualBenchmark(env, {
      runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 87 }),
    });

    assert.equal(result.trendSummaries.length, 1);
    assert.equal(result.trendSummaries[0]?.fixtureId, "simple-form");
    assert.equal(result.trendSummaries[0]?.screenId, simpleFormMetadata.source.nodeId);
    assert.equal(
      result.trendSummaries[0]?.screenName,
      simpleFormMetadata.source.nodeName,
    );
    assert.equal(result.trendSummaries[0]?.current, 87);
    assert.equal(result.trendSummaries[0]?.baseline, 90);
    assert.equal(result.trendSummaries[0]?.delta, -3);
    assert.equal(result.trendSummaries[0]?.direction, "down");
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark emits ALERT_VISUAL_QUALITY_DROP when drop exceeds configured threshold", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "simple-form",
            baseline: 100,
            current: 100,
            delta: 0,
            indicator: "neutral",
          },
        ],
        overallBaseline: 100,
        overallCurrent: 100,
        overallDelta: 0,
        alerts: [],
        trendSummaries: [],
      },
      env,
    );

    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          regression: {
            maxScoreDropPercent: 5,
            neutralTolerance: 1,
          },
        },
      },
      {
        runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 80 }),
      },
    );

    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0]?.code, "ALERT_VISUAL_QUALITY_DROP");
    assert.equal(result.alerts[0]?.severity, "warn");
    assert.ok(
      result.alerts[0]?.message.includes("simple-form"),
      "alert message should reference fixture id",
    );
    assert.equal(result.alerts[0]?.threshold, 5);
    assert.equal(result.alerts[0]?.value, 20);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark does not emit alert when drop is within neutralTolerance", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "simple-form",
            baseline: 90,
            current: 90,
            delta: 0,
            indicator: "neutral",
          },
        ],
        overallBaseline: 90,
        overallCurrent: 90,
        overallDelta: 0,
        alerts: [],
        trendSummaries: [],
      },
      env,
    );

    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          regression: {
            maxScoreDropPercent: 1,
            neutralTolerance: 3,
          },
        },
      },
      {
        runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 88 }),
      },
    );

    assert.equal(result.alerts.length, 0);
    assert.equal(result.trendSummaries[0]?.direction, "neutral");
    assert.equal(result.trendSummaries[0]?.withinTolerance, true);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark appends history entry when --update-baseline is passed", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    const result = await runVisualBenchmark(
      {
        ...env,
        updateBaseline: true,
      },
      {
        runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 92 }),
      },
    );

    const historyModule = await import("./visual-benchmark-history.js");
    const history = await historyModule.loadVisualBenchmarkHistory(env);
    assert.ok(
      history !== null,
      "history file must exist after baseline update",
    );
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0]?.scores.length, 1);
    assert.equal(history.entries[0]?.scores[0]?.fixtureId, "simple-form");
    assert.equal(
      history.entries[0]?.scores[0]?.screenId,
      simpleFormMetadata.source.nodeId,
    );
    assert.equal(
      history.entries[0]?.scores[0]?.screenName,
      simpleFormMetadata.source.nodeName,
    );
    assert.equal(history.entries[0]?.scores[0]?.score, 92);
    assert.equal(result.overallCurrent, 92);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark appends history entry on ordinary benchmark runs", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await runVisualBenchmark(env, {
      runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 92 }),
    });

    const historyModule = await import("./visual-benchmark-history.js");
    const history = await historyModule.loadVisualBenchmarkHistory(env);
    assert.ok(history !== null, "history file must be created for ordinary runs");
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0]?.scores[0]?.fixtureId, "simple-form");
    assert.equal(
      history.entries[0]?.scores[0]?.screenId,
      simpleFormMetadata.source.nodeId,
    );
    const baseline = await loadVisualBenchmarkBaseline(env);
    assert.equal(
      baseline,
      null,
      "ordinary runs must not rewrite the baseline without update-baseline",
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark honours historySize when appending history from ordinary runs", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    const historyModule = await import("./visual-benchmark-history.js");
    // Seed history with 3 pre-existing entries
    await historyModule.saveVisualBenchmarkHistory(
      {
        version: 2,
        entries: [
          {
            runAt: "2026-04-01T00:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: simpleFormMetadata.source.nodeId,
                screenName: simpleFormMetadata.source.nodeName,
                score: 70,
              },
            ],
          },
          {
            runAt: "2026-04-02T00:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: simpleFormMetadata.source.nodeId,
                screenName: simpleFormMetadata.source.nodeName,
                score: 72,
              },
            ],
          },
          {
            runAt: "2026-04-03T00:00:00.000Z",
            scores: [
              {
                fixtureId: "simple-form",
                screenId: simpleFormMetadata.source.nodeId,
                screenName: simpleFormMetadata.source.nodeName,
                score: 74,
              },
            ],
          },
        ],
      },
      env,
    );

    await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          regression: { historySize: 2 },
        },
      },
      {
        runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 80 }),
      },
    );

    const history = await historyModule.loadVisualBenchmarkHistory(env);
    assert.ok(history !== null);
    assert.equal(history.entries.length, 2);
    // Oldest (2026-04-01, 2026-04-02) dropped, newest (2026-04-03, current run) kept
    assert.equal(history.entries[0]?.runAt, "2026-04-03T00:00:00.000Z");
    assert.equal(history.entries[1]?.scores[0]?.score, 80);
    assert.equal(
      history.entries[1]?.scores[0]?.screenId,
      simpleFormMetadata.source.nodeId,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark uses resolved regression config from quality config", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "simple-form",
            baseline: 90,
            current: 90,
            delta: 0,
            indicator: "neutral",
          },
        ],
        overallBaseline: 90,
        overallCurrent: 90,
        overallDelta: 0,
        alerts: [],
        trendSummaries: [],
      },
      env,
    );

    // With neutralTolerance=5, a -4 delta is within tolerance -> neutral, no alert
    const result = await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          regression: { neutralTolerance: 5, maxScoreDropPercent: 1 },
        },
      },
      {
        runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 86 }),
      },
    );

    assert.equal(result.deltas[0]?.indicator, "neutral");
    assert.equal(result.alerts.length, 0);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark with default config uses 5% maxScoreDropPercent and 1-point neutralTolerance", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "simple-form",
            baseline: 100,
            current: 100,
            delta: 0,
            indicator: "neutral",
          },
        ],
        overallBaseline: 100,
        overallCurrent: 100,
        overallDelta: 0,
        alerts: [],
        trendSummaries: [],
      },
      env,
    );

    // Drop of 10% with no regression config -> defaults apply -> alert emitted
    const result = await runVisualBenchmark(env, {
      runFixtureBenchmark: async (fixtureId) => ({ fixtureId, score: 90 }),
    });

    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0]?.threshold, 5);
    assert.equal(result.alerts[0]?.value, 10);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("committed integration/fixtures/visual-benchmark/history.json parses as valid empty history", async () => {
  const historyModule = await import("./visual-benchmark-history.js");
  const committed = await historyModule.loadVisualBenchmarkHistory();
  assert.ok(
    committed !== null,
    "history.json should be committed and loadable",
  );
  assert.equal(committed.version, 2);
  assert.ok(Array.isArray(committed.entries));
});
