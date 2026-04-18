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
  resolveVisualBenchmarkFixturePaths,
  resolveVisualBenchmarkScreenPaths,
  resolveVisualBenchmarkScreenViewportPaths,
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
  runVisualBenchmarkMaintenance,
  updateVisualBenchmarkReferences,
  runVisualBenchmarkLiveAudit,
} from "./visual-benchmark.update.js";
import {
  resolveVisualBenchmarkCliResolution,
  runVisualBenchmarkCli,
} from "./visual-benchmark.cli.js";
import {
  blendVisualBenchmarkHeadlineScore,
  computeVisualBenchmarkDeltas,
  computeVisualBenchmarkScores,
  formatVisualBenchmarkTable,
  getVisualBenchmarkScoreKey,
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  loadVisualBenchmarkLastRunArtifact,
  prepareStorybookComponentFixtures,
  runVisualBenchmark,
  saveVisualBenchmarkBaseline,
  saveVisualBenchmarkBaselineScores,
  saveVisualBenchmarkLastRunArtifact,
  type VisualBenchmarkBaseline,
  type VisualBenchmarkResult,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  loadVisualBenchmarkViewCatalog,
  resolveVisualBenchmarkCanonicalReferencePaths,
  toCatalogViewMapByFixture,
} from "./visual-benchmark-view-catalog.js";

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

const writeBenchmarkFixture = async ({
  fixtureRoot,
  artifactRoot,
  metadata,
}: {
  fixtureRoot: string;
  artifactRoot: string;
  metadata: VisualBenchmarkFixtureMetadata;
}): Promise<void> => {
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
      name: metadata.source.nodeName,
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
};

const singleScreenRunResult = (
  fixtureId: string,
  score: number,
  screenId: string = simpleFormMetadata.source.nodeId,
  screenName: string = simpleFormMetadata.source.nodeName,
) => ({
  fixtureId,
  aggregateScore: score,
  screens: [
    {
      screenId,
      screenName,
      score,
    },
  ],
});

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
  assert.equal(metadata.version, 4);
  assert.equal(metadata.fixtureId, "simple-form");
  assert.equal(metadata.mode, "generated_app_screen");
  assert.equal(metadata.source.fileKey, "DUArQ8VuM3aPMjXFLaQSSH");
  assert.equal(metadata.source.nodeId, "1:65671");
  assert.equal(metadata.export.format, "png");
  assert.ok(metadata.viewport.width > 0);
  assert.ok(metadata.viewport.height > 0);
  assert.ok(
    metadata.viewport.deviceScaleFactor === undefined ||
      metadata.viewport.deviceScaleFactor >= 1,
  );
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
  assert.match(requestedUrls[0], /depth=8/);
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

test("updateVisualBenchmarkReferences writes canonical Figma references and keeps legacy aliases in sync", async () => {
  const fixtureRoot = await createFixtureRoot();
  const canonicalBuffer = createTestPngBuffer(16, 12, [10, 20, 30, 255]);
  const simpleFormView = {
    fixtureId: "simple-form",
    label: "Test-View-01",
    fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
    nodeId: "1:65671",
    nodeName:
      "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
    referenceVersion: 1,
    export: {
      format: "png" as const,
      scale: 2,
    },
    comparison: {
      viewportId: "desktop",
      maxDiffPercent: 0.1,
    },
  };
  const minimumCatalogViews = [
    simpleFormView,
    {
      fixtureId: "complex-dashboard",
      label: "Test-View-02",
      fileKey: "E5h5554zKbYsIutW9hEro4",
      nodeId: "2:46031",
      nodeName: "Frame 1",
      referenceVersion: 1,
      export: { format: "png" as const, scale: 2 },
      comparison: { viewportId: "desktop", maxDiffPercent: 0.1 },
    },
    {
      fixtureId: "data-table",
      label: "Test-View-03",
      fileKey: "M7FGS79qLfr3O4OXEYbxy0",
      nodeId: "4:38304",
      nodeName:
        "Bedarfsermittlung; Netto + Betriebsmittel; Maximalausprägung: Alle Cluster Expanded  ID-003.4_v1",
      referenceVersion: 1,
      export: { format: "png" as const, scale: 2 },
      comparison: { viewportId: "desktop", maxDiffPercent: 0.1 },
    },
    {
      fixtureId: "navigation-sidebar",
      label: "Test-View-04",
      fileKey: "LATywBmBgvfBp1VvwUsGNB",
      nodeId: "1:48176",
      nodeName: "Empty State ID-001.1_v1",
      referenceVersion: 1,
      export: { format: "png" as const, scale: 2 },
      comparison: { viewportId: "desktop", maxDiffPercent: 0.1 },
    },
    {
      fixtureId: "design-system-showcase",
      label: "Test-View-05",
      fileKey: "xr6NfWtzAj4mAk54ZsBs53",
      nodeId: "1:63838",
      nodeName: "NEO Desktop (stationär) ID-001.7_v1",
      referenceVersion: 1,
      export: { format: "png" as const, scale: 2 },
      comparison: { viewportId: "desktop", maxDiffPercent: 0.1 },
    },
  ];

  try {
    await writeFile(
      path.join(fixtureRoot, "benchmark-views.json"),
      JSON.stringify(
        {
          version: 2,
          views: minimumCatalogViews,
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.FIGMA_ACCESS_TOKEN = "test-token";
    let fetchCall = 0;
    await updateVisualBenchmarkReferences({
      fixtureRoot,
      now: () => "2026-04-10T12:00:00.000Z",
      log: () => {
        return;
      },
      fetchImpl: async (url) => {
        fetchCall += 1;
        if (fetchCall === 1) {
          return createJsonResponse({
            lastModified: "2026-04-10T09:15:00Z",
            nodes: {
              "1:65671": {
                document: {
                  id: "1:65671",
                  name: "Simple Form",
                  absoluteBoundingBox: {
                    width: 1336,
                    height: 1578,
                  },
                },
              },
            },
          });
        }
        if (fetchCall === 2) {
          return createJsonResponse({
            images: {
              "1:65671": "https://example.test/simple-form-reference.png",
            },
          });
        }
        return new Response(canonicalBuffer, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
          },
        });
      },
    });

    const fixtureReference = await readFile(
      resolveVisualBenchmarkFixturePaths("simple-form", { fixtureRoot })
        .referencePngPath,
    );
    assert.equal(fixtureReference.equals(canonicalBuffer), true);

    const legacyScreenReference = await readFile(
      resolveVisualBenchmarkScreenPaths("simple-form", "1:65671", {
        fixtureRoot,
      }).referencePngPath,
    );
    assert.equal(legacyScreenReference.equals(canonicalBuffer), true);

    const desktopReference = await readFile(
      resolveVisualBenchmarkScreenViewportPaths(
        "simple-form",
        "1:65671",
        "desktop",
        { fixtureRoot },
      ).referencePngPath,
    );
    assert.equal(desktopReference.equals(canonicalBuffer), true);

    const canonicalPaths = resolveVisualBenchmarkCanonicalReferencePaths(
      simpleFormView,
      { fixtureRoot },
    );
    const canonicalReference = await readFile(canonicalPaths.figmaPngPath);
    assert.equal(canonicalReference.equals(canonicalBuffer), true);
    const canonicalMeta = JSON.parse(
      await readFile(canonicalPaths.referenceMetaJsonPath, "utf8"),
    ) as {
      referenceVersion: number;
      comparison: { viewportId: string };
      sha256: string;
    };
    assert.equal(canonicalMeta.referenceVersion, 1);
    assert.equal(canonicalMeta.comparison.viewportId, "desktop");
    assert.equal(typeof canonicalMeta.sha256, "string");
    assert.equal(canonicalMeta.sha256.length > 0, true);

    const updatedMetadata = await loadVisualBenchmarkFixtureMetadata(
      "simple-form",
      { fixtureRoot },
    );
    assert.equal(updatedMetadata.capturedAt, "2026-04-10T12:00:00.000Z");
    assert.deepEqual(updatedMetadata.viewport, {
      width: 16,
      height: 12,
      deviceScaleFactor: 1,
    });
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

test("runVisualBenchmarkMaintenance keeps strict visual-quality execution when updating baseline", async () => {
  const fixtureRoot = await createFixtureRoot();
  const receivedExecutionOptions: Array<{
    allowIncompleteVisualQuality?: boolean;
    qualityConfig?: unknown;
  }> = [];

  try {
    const qualityConfig = {
      regression: {
        historySize: 3,
      },
    };

    await runVisualBenchmarkMaintenance(["--update-baseline"], {
      fixtureRoot,
      qualityConfig,
      log: () => {
        return;
      },
      executeFixture: async (fixtureId, options) => {
        receivedExecutionOptions.push({
          allowIncompleteVisualQuality: options?.allowIncompleteVisualQuality,
          qualityConfig: options?.qualityConfig,
        });
        return {
          fixtureId,
          aggregateScore: 92,
          screens: [
            {
              screenId: simpleFormMetadata.source.nodeId,
              screenName: simpleFormMetadata.source.nodeName,
              nodeId: simpleFormMetadata.source.nodeId,
              score: 92,
              screenshotBuffer: createTestPngBuffer(8, 8, [255, 255, 255, 255]),
              diffBuffer: null,
              report: createCompletedVisualQualityReport(92),
              viewport: {
                width: 1280,
                height: 720,
                deviceScaleFactor: 1,
              },
            },
          ],
        };
      },
    });

    assert.equal(receivedExecutionOptions.length, 1);
    assert.equal(
      receivedExecutionOptions[0]?.allowIncompleteVisualQuality,
      undefined,
    );
    assert.deepEqual(receivedExecutionOptions[0]?.qualityConfig, qualityConfig);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
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
  assert.ok(
    ids.length >= 5,
    `Expected at least 5 fixture IDs, got ${ids.length}.`,
  );
});

test("all 5 fixtures can be loaded (manifest, metadata, figma.json, reference.png)", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  const catalog = await loadVisualBenchmarkViewCatalog();
  const byFixture = toCatalogViewMapByFixture(catalog);
  for (const id of ids) {
    const manifest = await loadVisualBenchmarkFixtureManifest(id);
    const metadata = await loadVisualBenchmarkFixtureMetadata(id);
    assert.equal(manifest.fixtureId, id);
    assert.equal(manifest.visualQuality.frozenReferenceImage, "reference.png");
    assert.equal(
      manifest.visualQuality.frozenReferenceMetadata,
      "metadata.json",
    );
    assert.equal(metadata.version, 4);
    assert.equal(metadata.mode, "generated_app_screen");
    assert.equal(metadata.fixtureId, id);
    const view = byFixture.get(id);
    assert.ok(view, `Expected benchmark view catalog entry for '${id}'.`);
    assert.equal(metadata.source.fileKey, view.fileKey);
    assert.equal(metadata.source.nodeId, view.nodeId);
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
    runFixtureBenchmark: async (fixtureId) => {
      const screenScore = fixtureId === "simple-form" ? 91 : 90;
      return {
        fixtureId,
        aggregateScore: screenScore,
        screens: [
          {
            screenId: fixtureId,
            screenName: fixtureId,
            score: screenScore,
          },
        ],
      };
    },
  });
  assert.ok(scores.length >= 5, "Expected scores for at least 5 fixtures.");
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
    {
      fixtureId: "fixture-a",
      screenId: "screen-a",
      screenName: "Screen A",
      score: 95,
    },
    {
      fixtureId: "fixture-a",
      screenId: "screen-b",
      screenName: "Screen B",
      score: 80,
    },
    {
      fixtureId: "fixture-c",
      screenId: "screen-c",
      screenName: "Screen C",
      score: 100,
    },
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: [
      {
        fixtureId: "fixture-a",
        screenId: "screen-a",
        screenName: "Screen A",
        score: 90,
      },
      {
        fixtureId: "fixture-a",
        screenId: "screen-b",
        screenName: "Screen B",
        score: 85,
      },
      {
        fixtureId: "fixture-c",
        screenId: "screen-c",
        screenName: "Screen C",
        score: 100,
      },
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
    {
      fixtureId: "fixture-a",
      screenId: "screen-a",
      screenName: "Screen A",
      score: 88,
    },
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

test("blendVisualBenchmarkHeadlineScore blends screen and component aggregates with the fixed 70/30 policy", () => {
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: 80,
      componentAggregateScore: 60,
    }),
    74,
  );
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: 80,
    }),
    80,
  );
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      componentAggregateScore: 60,
    }),
    60,
  );
});

test("prepareStorybookComponentFixtures synthesizes runnable component fixtures from the visual catalog", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-storybook-component-fixtures-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const catalogPath = path.join(
    root,
    "storybook.component-visual-catalog.json",
  );

  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeFile(
      catalogPath,
      `${JSON.stringify(
        {
          artifact: "storybook.component-visual-catalog",
          version: 1,
          stats: {
            totalCount: 2,
            readyCount: 1,
            skippedCount: 1,
            byMatchStatus: {
              matched: 1,
              ambiguous: 0,
              unmatched: 1,
            },
            bySkipReason: {
              unmatched: 0,
              ambiguous: 0,
              docs_only: 1,
              missing_story: 0,
              missing_reference_node: 0,
              missing_authoritative_story: 0,
            },
          },
          entries: [
            {
              componentId: "button::button--primary",
              figmaFamilyKey: "button",
              figmaFamilyName: "Button",
              matchStatus: "matched",
              comparisonStatus: "ready",
              storyEntryId: "button--primary",
              storyTitle: "Button/Primary",
              iframeId: "button--primary",
              referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
              referenceNodeId: "12:34",
              captureStrategy: "storybook_root_union",
              baselineCanvas: {
                padding: 16,
              },
              warnings: [],
            },
            {
              componentId: "input::input--docs",
              figmaFamilyKey: "input",
              figmaFamilyName: "Input",
              matchStatus: "unmatched",
              comparisonStatus: "skipped",
              skipReason: "docs_only",
              warnings: ["requires authoritative story"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const prepared = await prepareStorybookComponentFixtures(
      {
        fixtureRoot,
        componentVisualCatalogFile: catalogPath,
      },
      {
        fetchReferenceImage: async () =>
          createTestPngBuffer(120, 64, [12, 34, 56, 255]),
      },
    );

    try {
      assert.ok(
        prepared.options?.fixtureRoot,
        "Expected a synthesized fixture root",
      );
      assert.notEqual(prepared.options?.fixtureRoot, fixtureRoot);
      assert.equal(prepared.skippedComponents[0]?.skipReason, "docs_only");
      assert.equal(prepared.skippedCoverage.skippedCount, 1);
      assert.equal(prepared.skippedCoverage.bySkipReason.docs_only, 1);

      const metadata = await loadVisualBenchmarkFixtureMetadata(
        "storybook-components",
        {
          fixtureRoot: prepared.options?.fixtureRoot,
        },
      );
      assert.equal(metadata.mode, "storybook_component");
      assert.equal(metadata.screens?.[0]?.screenId, "button::button--primary");
      assert.deepEqual(metadata.screens?.[0]?.baselineCanvas, {
        width: 120,
        height: 64,
      });
      assert.deepEqual(metadata.screens?.[0]?.viewports, [
        {
          id: "default",
          width: 152,
          height: 96,
        },
      ]);

      const referenceBuffer = await readFile(
        resolveVisualBenchmarkScreenViewportPaths(
          "storybook-components",
          "button::button--primary",
          "default",
          {
            fixtureRoot: prepared.options?.fixtureRoot,
          },
        ).referencePngPath,
      );
      assert.ok(isValidPngBuffer(referenceBuffer));
    } finally {
      await prepared.cleanup?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepareStorybookComponentFixtures reuses frozen component references in ci mode without live fetch", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-storybook-component-ci-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const catalogPath = path.join(
    root,
    "storybook.component-visual-catalog.json",
  );
  const screenId = "button::button--primary";

  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeFile(
      catalogPath,
      `${JSON.stringify(
        {
          artifact: "storybook.component-visual-catalog",
          version: 1,
          stats: {
            totalCount: 1,
            readyCount: 1,
            skippedCount: 0,
            byMatchStatus: {
              matched: 1,
              ambiguous: 0,
              unmatched: 0,
            },
            bySkipReason: {
              unmatched: 0,
              ambiguous: 0,
              docs_only: 0,
              missing_story: 0,
              missing_reference_node: 0,
              missing_authoritative_story: 0,
            },
          },
          entries: [
            {
              componentId: screenId,
              figmaFamilyKey: "button",
              figmaFamilyName: "Button",
              matchStatus: "matched",
              comparisonStatus: "ready",
              storyEntryId: "button--primary",
              storyTitle: "Button/Primary",
              iframeId: "button--primary",
              referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
              referenceNodeId: "12:34",
              captureStrategy: "storybook_root_union",
              baselineCanvas: {
                padding: 16,
              },
              warnings: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const frozenReferencePath = resolveVisualBenchmarkScreenViewportPaths(
      "storybook-components",
      screenId,
      "default",
      { fixtureRoot },
    ).referencePngPath;
    await mkdir(path.dirname(frozenReferencePath), { recursive: true });
    await writeFile(
      frozenReferencePath,
      createTestPngBuffer(90, 40, [120, 80, 220, 255]),
    );

    let fetchCalls = 0;
    const prepared = await prepareStorybookComponentFixtures(
      {
        fixtureRoot,
        componentVisualCatalogFile: catalogPath,
        ci: true,
      },
      {
        fetchReferenceImage: async () => {
          fetchCalls += 1;
          return createTestPngBuffer(1, 1, [0, 0, 0, 255]);
        },
      },
    );

    try {
      assert.equal(fetchCalls, 0);
      const metadata = await loadVisualBenchmarkFixtureMetadata(
        "storybook-components",
        {
          fixtureRoot: prepared.options?.fixtureRoot,
        },
      );
      assert.deepEqual(metadata.screens?.[0]?.viewports, [
        {
          id: "default",
          width: 122,
          height: 72,
        },
      ]);
    } finally {
      await prepared.cleanup?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runVisualBenchmark blends generated screens with storybook component aggregates and surfaces component coverage warnings", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-blend-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  const screenFixtureId = "app-screen";
  const componentFixtureId = "storybook-components";
  try {
    await writeBenchmarkFixture({
      fixtureRoot,
      artifactRoot,
      metadata: {
        ...simpleFormMetadata,
        fixtureId: screenFixtureId,
        source: {
          ...simpleFormMetadata.source,
          nodeId: "1:100",
          nodeName: "App Screen",
        },
      },
    });
    await writeBenchmarkFixture({
      fixtureRoot,
      artifactRoot,
      metadata: {
        version: 4,
        mode: "storybook_component",
        fixtureId: componentFixtureId,
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "12:34",
          nodeName: "Storybook Components",
          lastModified: "2026-03-30T20:59:16Z",
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
            referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
            captureStrategy: "storybook_root_union",
            baselineCanvas: { width: 120, height: 96 },
          },
        ],
      },
    });

    await saveVisualBenchmarkBaselineScores(
      [
        {
          fixtureId: screenFixtureId,
          screenId: "1:100",
          screenName: "App Screen",
          score: 70,
        },
        {
          fixtureId: componentFixtureId,
          screenId: "button-primary",
          screenName: "Button / Primary",
          score: 50,
        },
      ],
      { fixtureRoot, artifactRoot },
    );

    const result = await runVisualBenchmark(
      { fixtureRoot, artifactRoot },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === screenFixtureId) {
            return {
              fixtureId,
              aggregateScore: 80,
              screens: [
                {
                  screenId: "1:100",
                  screenName: "App Screen",
                  nodeId: "1:100",
                  status: "completed" as const,
                  score: 80,
                  screenshotBuffer: createTestPngBuffer(
                    4,
                    4,
                    [10, 20, 30, 255],
                  ),
                  diffBuffer: createTestPngBuffer(4, 4, [0, 0, 0, 0]),
                  report: createCompletedVisualQualityReport(80),
                  viewport: { width: 1280, height: 720 },
                },
              ],
              screenAggregateScore: 80,
            };
          }
          return {
            fixtureId,
            aggregateScore: 60,
            componentAggregateScore: 60,
            componentCoverage: {
              comparedCount: 1,
              skippedCount: 1,
              coveragePercent: 50,
              bySkipReason: { incomplete_mapping: 1 },
            },
            warnings: [
              "Storybook component coverage skipped 1 component screen.",
            ],
            screens: [
              {
                screenId: "button-primary",
                screenName: "Button / Primary",
                nodeId: "12:34",
                status: "completed" as const,
                score: 60,
                screenshotBuffer: createTestPngBuffer(4, 4, [40, 50, 60, 255]),
                diffBuffer: createTestPngBuffer(4, 4, [0, 0, 0, 0]),
                report: createCompletedVisualQualityReport(60),
                viewport: { width: 120, height: 96 },
              },
            ],
          };
        },
      },
    );

    assert.equal(result.screenAggregateScore, 80);
    assert.equal(result.componentAggregateScore, 60);
    assert.equal(result.overallCurrent, 74);
    assert.equal(result.overallBaseline, 64);
    assert.equal(result.overallDelta, 10);
    assert.equal(result.componentCoverage?.comparedCount, 1);
    assert.equal(result.componentCoverage?.skippedCount, 1);
    assert.equal(result.componentCoverage?.bySkipReason.incomplete_mapping, 1);
    assert.match(result.warnings?.[0] ?? "", /component coverage skipped/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runVisualBenchmark emits overfitting alert when screen aggregate improves while Storybook components regress", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-overfitting-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  const screenFixtureId = "app-screen";
  const componentFixtureId = "storybook-components";
  try {
    await writeBenchmarkFixture({
      fixtureRoot,
      artifactRoot,
      metadata: {
        ...simpleFormMetadata,
        fixtureId: screenFixtureId,
        source: {
          ...simpleFormMetadata.source,
          nodeId: "1:900",
          nodeName: "App Screen",
        },
      },
    });
    await writeBenchmarkFixture({
      fixtureRoot,
      artifactRoot,
      metadata: {
        version: 4,
        mode: "storybook_component",
        fixtureId: componentFixtureId,
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "12:34",
          nodeName: "Storybook Components",
          lastModified: "2026-03-30T20:59:16Z",
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
            referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
            captureStrategy: "storybook_root_union",
            baselineCanvas: { width: 120, height: 96 },
          },
        ],
      },
    });

    await saveVisualBenchmarkBaselineScores(
      [
        {
          fixtureId: screenFixtureId,
          screenId: "1:900",
          screenName: "App Screen",
          score: 70,
        },
        {
          fixtureId: componentFixtureId,
          screenId: "button-primary",
          screenName: "Button / Primary",
          score: 80,
        },
      ],
      { fixtureRoot, artifactRoot },
    );

    const result = await runVisualBenchmark(
      { fixtureRoot, artifactRoot },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === screenFixtureId) {
            return {
              fixtureId,
              aggregateScore: 82,
              screens: [
                {
                  screenId: "1:900",
                  screenName: "App Screen",
                  nodeId: "1:900",
                  status: "completed" as const,
                  score: 82,
                  screenshotBuffer: createTestPngBuffer(
                    4,
                    4,
                    [10, 20, 30, 255],
                  ),
                  diffBuffer: createTestPngBuffer(4, 4, [0, 0, 0, 0]),
                  report: createCompletedVisualQualityReport(82),
                  viewport: { width: 1280, height: 720 },
                },
              ],
            };
          }
          return {
            fixtureId,
            aggregateScore: 68,
            componentAggregateScore: 68,
            componentCoverage: {
              comparedCount: 1,
              skippedCount: 0,
              coveragePercent: 100,
              bySkipReason: {},
            },
            screens: [
              {
                screenId: "button-primary",
                screenName: "Button / Primary",
                nodeId: "12:34",
                status: "completed" as const,
                score: 68,
                screenshotBuffer: createTestPngBuffer(4, 4, [40, 50, 60, 255]),
                diffBuffer: createTestPngBuffer(4, 4, [0, 0, 0, 0]),
                report: createCompletedVisualQualityReport(68),
                viewport: { width: 120, height: 96 },
              },
            ],
          };
        },
      },
    );

    assert.equal(
      result.alerts.some(
        (alert) => alert.code === "ALERT_VISUAL_QUALITY_OVERFITTING_RISK",
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.equal(baseline.scores.length, 15);
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
          aggregateScore: 87.5,
          screens: [
            {
              screenId: simpleFormMetadata.source.nodeId,
              screenName: simpleFormMetadata.source.nodeName,
              score: 87.5,
              screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
              diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
              report: createCompletedVisualQualityReport(),
              viewport: { width: 1280, height: 720 },
            },
          ],
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
          aggregateScore: 50,
          screens: [
            {
              screenId: "2:2222",
              screenName: "Fixture Screen",
              score: 50,
              screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
              diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
              report: null,
              viewport: { width: 1280, height: 720 },
            },
          ],
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
          aggregateScore: 44,
          screens: [
            {
              screenId: "2:3333",
              screenName: "Marketing Page",
              score: 44,
              screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
              diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
              report: null,
              viewport: { width: 1280, height: 720 },
            },
          ],
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
          aggregateScore: 75,
          screens: [
            {
              screenId: simpleFormMetadata.source.nodeId,
              screenName: simpleFormMetadata.source.nodeName,
              score: 75,
              screenshotBuffer: createTestPngBuffer(8, 8, [200, 10, 10, 255]),
              diffBuffer: createTestPngBuffer(8, 8, [10, 200, 10, 255]),
              report: createCompletedVisualQualityReport(75),
              viewport: { width: 1280, height: 720 },
            },
          ],
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

test("visual benchmark workflow enforces thresholds and updates the existing check run", async () => {
  const workflow = await readFile(
    path.join(process.cwd(), ".github", "workflows", "visual-benchmark.yml"),
    "utf8",
  );
  assert.match(workflow, /name:\s+benchmark/);
  assert.match(workflow, /Run visual benchmark verification suites/);
  assert.match(
    workflow,
    /pnpm exec tsx --test src\/job-engine\/visual-capture\.test\.ts src\/job-engine\/visual-diff\.test\.ts src\/job-engine\/visual-scoring\.test\.ts src\/job-engine\/pipeline\/orchestrator\.test\.ts/,
  );
  assert.match(
    workflow,
    /pnpm exec tsx --test integration\/visual-benchmark\.execution\.test\.ts integration\/visual-benchmark\.test\.ts integration\/visual-benchmark-runner\.error-isolation\.test\.ts integration\/visual-quality-config\.test\.ts/,
  );
  assert.match(
    workflow,
    /pnpm exec tsx --test integration\/mutation-testing\.integration\.test\.ts integration\/visual-benchmark\.cli\.test\.ts integration\/visual-benchmark-summary\.test\.ts/,
  );
  assert.match(
    workflow,
    /pnpm exec tsx --test src\/parity\/ir-classification\.test\.ts src\/parity\/ir-screen-variants\.test\.ts src\/parity\/ir\.test\.ts/,
  );
  assert.match(
    workflow,
    /pnpm exec vitest run --config ui-src\/vite\.config\.ts ui-src\/src\/features\/visual-quality\/data\/report-schema\.test\.ts ui-src\/src\/features\/visual-quality\/data\/file-source\.test\.ts/,
  );
  assert.match(workflow, /pnpm benchmark:visual -- --ci --enforce-thresholds/);
  assert.match(
    workflow,
    /--storybook-component-catalog integration\/fixtures\/customer-board-golden\/derived\/storybook\.component-visual-catalog\.json/,
  );
  assert.match(
    workflow,
    /--storybook-static-dir storybook-static\/storybook-static/,
  );
  assert.doesNotMatch(workflow, /FIGMA_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /FIGMA_FILE_KEY/);
  assert.match(
    workflow,
    /actions\/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3/,
  );
  assert.match(workflow, /check-output\.json/);
  assert.match(workflow, /github\.rest\.checks\.update/);
  assert.match(workflow, /integration\/composite-quality\*/);
  assert.match(workflow, /scripts\/compute-composite-quality\.ts/);
  assert.match(workflow, /scripts\/print-visual-benchmark-summary\.mjs/);
  assert.match(workflow, /scripts\/visual-benchmark-summary\.mjs/);
  assert.match(workflow, /scripts\/print-visual-benchmark-pr-comment\.mjs/);
  assert.match(workflow, /pnpm perf:web:assert/);
  assert.match(workflow, /pnpm composite:quality/);
  assert.match(workflow, /composite-quality-report\.json/);
  assert.match(
    workflow,
    /if: always\(\) && hashFiles\('artifacts\/visual-benchmark\/last-run\.json'\) != ''/,
  );
  assert.doesNotMatch(
    workflow,
    /workflows\/visual-benchmark-comment\.yml/,
  );
  assert.match(
    workflow,
    /name:\s+Post or update visual benchmark PR comment/,
  );
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
  assert.match(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
});

test("visual benchmark workflow posts marker-based upserts directly for same-repo pull requests", async () => {
  const workflow = await readFile(
    path.join(
      process.cwd(),
      ".github",
      "workflows/visual-benchmark.yml",
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /if:\s+always\(\) && steps\.benchmark-run\.outcome == 'success' && hashFiles\('artifacts\/visual-benchmark\/pr-comment\.json'\) != '' && github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
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
      runFixtureBenchmark: async (fixtureId) =>
        singleScreenRunResult(fixtureId, 87),
    });

    assert.equal(result.trendSummaries.length, 1);
    assert.equal(result.trendSummaries[0]?.fixtureId, "simple-form");
    assert.equal(
      result.trendSummaries[0]?.screenId,
      simpleFormMetadata.source.nodeId,
    );
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
        runFixtureBenchmark: async (fixtureId) =>
          singleScreenRunResult(fixtureId, 80),
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
        runFixtureBenchmark: async (fixtureId) =>
          singleScreenRunResult(fixtureId, 88),
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
        runFixtureBenchmark: async (fixtureId) =>
          singleScreenRunResult(fixtureId, 92),
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

test("runVisualBenchmark does not append history on ordinary benchmark runs", async () => {
  const env = await createBenchmarkFixtureEnvironment();
  try {
    await runVisualBenchmark(env, {
      runFixtureBenchmark: async (fixtureId) =>
        singleScreenRunResult(fixtureId, 92),
    });

    const historyModule = await import("./visual-benchmark-history.js");
    const history = await historyModule.loadVisualBenchmarkHistory(env);
    assert.equal(
      history,
      null,
      "history file must not be created for ordinary runs",
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

test("runVisualBenchmark honours historySize when appending history from update-baseline runs", async () => {
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
        updateBaseline: true,
        qualityConfig: {
          regression: { historySize: 2 },
        },
      },
      {
        runFixtureBenchmark: async (fixtureId) =>
          singleScreenRunResult(fixtureId, 80),
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
        runFixtureBenchmark: async (fixtureId) =>
          singleScreenRunResult(fixtureId, 86),
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
      runFixtureBenchmark: async (fixtureId) =>
        singleScreenRunResult(fixtureId, 90),
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

// ---------------------------------------------------------------------------
// Issue #837 — Multi-Screen Visual Comparison
// ---------------------------------------------------------------------------

test("committed integration/fixtures/visual-benchmark/baseline.json remains v3 and covers the canonical benchmark views without hard-coding an exact fixture count", async () => {
  const baseline = await loadVisualBenchmarkBaseline();
  const viewCatalog = await loadVisualBenchmarkViewCatalog();
  assert.ok(baseline !== null, "baseline.json should be committed");
  assert.equal(baseline.version, 3);
  assert.ok(
    baseline.scores.length >= viewCatalog.views.length,
    `baseline should contain at least one score per canonical benchmark view (expected >= ${String(viewCatalog.views.length)}, got ${String(baseline.scores.length)})`,
  );
  const fixtureIds = baseline.scores.map((entry) => entry.fixtureId);
  for (const view of viewCatalog.views) {
    assert.ok(
      fixtureIds.includes(view.fixtureId),
      `baseline should include canonical fixture '${view.fixtureId}'.`,
    );
  }
  const viewportIds = baseline.scores.map((entry) => entry.viewportId);
  assert.ok(viewportIds.includes("desktop"));
  assert.ok(viewportIds.includes("tablet"));
  assert.ok(viewportIds.includes("mobile"));
});

test("runVisualBenchmark processes a 2-screen synthetic v2 fixture with internal fan-out", async () => {
  const { computeFixtureAggregate } =
    await import("./visual-benchmark-runner.js");
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "multi-screen-fixture",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Dashboard Home",
    },
  });
  try {
    // Upgrade the fixture metadata to v2 with two screens
    await writeVisualBenchmarkFixtureMetadata(
      "multi-screen-fixture",
      {
        version: 2,
        fixtureId: "multi-screen-fixture",
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "2:10001",
          nodeName: "Fixture Root",
          lastModified: "2026-03-30T20:59:16Z",
        },
        viewport: { width: 1280, height: 720 },
        export: { format: "png", scale: 2 },
        screens: [
          {
            screenId: "2:10001",
            screenName: "Dashboard Home",
            nodeId: "2:10001",
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            nodeId: "2:10002",
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      { fixtureRoot: env.fixtureRoot },
    );

    const result = await runVisualBenchmark(env, {
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 85,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Dashboard Home",
            score: 90,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(90),
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            score: 80,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(80),
            viewport: { width: 1280, height: 720 },
          },
        ],
      }),
    });

    // Two deltas one per screen
    const fixtureDeltas = result.deltas.filter(
      (delta) => delta.fixtureId === "multi-screen-fixture",
    );
    assert.equal(fixtureDeltas.length, 2);
    assert.ok(
      fixtureDeltas.some(
        (delta) => delta.screenId === "2:10001" && delta.current === 90,
      ),
    );
    assert.ok(
      fixtureDeltas.some(
        (delta) => delta.screenId === "2:10002" && delta.current === 80,
      ),
    );
    // Aggregate mean
    assert.equal(
      computeFixtureAggregate(
        fixtureDeltas.map((delta) => ({ score: delta.current })),
      ),
      85,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("computeFixtureAggregate computes arithmetic mean when no weights are declared", async () => {
  const { computeFixtureAggregate } =
    await import("./visual-benchmark-runner.js");
  assert.equal(computeFixtureAggregate([{ score: 90 }, { score: 80 }]), 85);
  assert.equal(
    computeFixtureAggregate([{ score: 100 }, { score: 50 }, { score: 75 }]),
    75,
  );
  assert.equal(computeFixtureAggregate([{ score: 88 }]), 88);
});

test("computeFixtureAggregate computes weighted mean when at least one weight is declared", async () => {
  const { computeFixtureAggregate } =
    await import("./visual-benchmark-runner.js");
  assert.equal(
    computeFixtureAggregate([
      { score: 80, weight: 1 },
      { score: 90, weight: 2 },
      { score: 100, weight: 1 },
    ]),
    90,
  );
  assert.equal(
    computeFixtureAggregate([{ score: 80, weight: 3 }, { score: 100 }]),
    85,
  );
});

test("computeFixtureAggregate throws when given an empty array", async () => {
  const { computeFixtureAggregate } =
    await import("./visual-benchmark-runner.js");
  assert.throws(() => computeFixtureAggregate([]), /empty|at least one/i);
});

test("blendVisualBenchmarkHeadlineScore applies 70/30 weighting and single-side fallback", () => {
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: 80,
      componentAggregateScore: 90,
    }),
    83,
  );
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: 80,
      componentAggregateScore: null,
    }),
    80,
  );
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: null,
      componentAggregateScore: 90,
    }),
    90,
  );
  assert.equal(
    blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: null,
      componentAggregateScore: null,
    }),
    null,
  );
});

test("runVisualBenchmark blends full-page and component aggregates while preserving component coverage", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "screen-fixture",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Screen Fixture",
    },
  });
  const componentMetadata: VisualBenchmarkFixtureMetadata = {
    version: 4,
    mode: "storybook_component",
    fixtureId: "component-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "12:34",
      nodeName: "Component Fixture",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: {
      width: 240,
      height: 160,
    },
    export: {
      format: "png",
      scale: 1,
    },
    screens: [
      {
        screenId: "button-primary",
        screenName: "Primary Button",
        storyTitle: "Components/Button/Primary",
        nodeId: "12:34",
        viewport: { width: 240, height: 160 },
        entryId: "components-button--primary",
        referenceNodeId: "12:34",
        referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        captureStrategy: "storybook_root_union",
        baselineCanvas: { width: 240, height: 160 },
      },
    ],
  };

  try {
    await writeBenchmarkFixture({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      metadata: componentMetadata,
    });

    const result = await runVisualBenchmark(
      {
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
      },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === "screen-fixture") {
            return {
              fixtureId,
              aggregateScore: 80,
              screens: [
                {
                  screenId: "2:10001",
                  screenName: "Screen Fixture",
                  nodeId: "2:10001",
                  status: "completed",
                  score: 80,
                  screenshotBuffer: createTestPngBuffer(
                    4,
                    4,
                    [255, 255, 255, 255],
                  ),
                  diffBuffer: null,
                  report: createCompletedVisualQualityReport(80),
                  viewport: { width: 1280, height: 720 },
                },
              ],
            };
          }

          return {
            fixtureId,
            aggregateScore: 90,
            componentAggregateScore: 90,
            componentCoverage: {
              comparedCount: 1,
              skippedCount: 1,
              coveragePercent: 50,
              bySkipReason: {
                incomplete_mapping: 1,
              },
            },
            warnings: [
              "Storybook component coverage skipped 1 component screen(s).",
            ],
            screens: [
              {
                screenId: "button-primary",
                screenName: "Components/Button/Primary",
                nodeId: "12:34",
                status: "completed",
                score: 90,
                screenshotBuffer: createTestPngBuffer(
                  4,
                  4,
                  [255, 255, 255, 255],
                ),
                diffBuffer: null,
                report: createCompletedVisualQualityReport(90),
                viewport: { width: 240, height: 160 },
              },
              {
                screenId: "button-secondary",
                screenName: "Components/Button/Secondary",
                nodeId: "12:35",
                status: "skipped",
                skipReason: "incomplete_mapping",
                warnings: ["missing required metadata"],
                score: 0,
                screenshotBuffer: createTestPngBuffer(1, 1, [0, 0, 0, 0]),
                diffBuffer: null,
                report: null,
                viewport: { width: 1, height: 1 },
              },
            ],
          };
        },
      },
    );

    assert.equal(result.screenAggregateScore, 80);
    assert.equal(result.componentAggregateScore, 90);
    assert.equal(result.overallCurrent, 83);
    assert.equal(result.componentCoverage?.comparedCount, 1);
    assert.equal(result.componentCoverage?.skippedCount, 1);
    assert.equal(result.componentCoverage?.bySkipReason.incomplete_mapping, 1);
    assert.ok(
      result.warnings?.includes(
        "Storybook component coverage skipped 1 component screen(s).",
      ),
    );
    const lastRun = await loadVisualBenchmarkLastRun({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
    });
    assert.ok(lastRun !== null);
    assert.equal(lastRun.componentAggregateScore, 90);
    assert.equal(lastRun.componentCoverage?.skippedCount, 1);
    assert.equal(lastRun.components?.[0]?.componentId, "button-primary");
    assert.equal(lastRun.components?.[0]?.status, "compared");
    assert.equal(lastRun.components?.[1]?.componentId, "button-secondary");
    assert.equal(lastRun.components?.[1]?.status, "skipped");
    assert.equal(lastRun.components?.[1]?.skipReason, "incomplete_mapping");
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark weights component screen aggregates before blending the headline score", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "screen-fixture",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10021",
      nodeName: "Screen Fixture",
    },
  });
  const componentMetadata: VisualBenchmarkFixtureMetadata = {
    version: 4,
    mode: "storybook_component",
    fixtureId: "component-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "12:34",
      nodeName: "Component Fixture",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: {
      width: 240,
      height: 160,
    },
    export: {
      format: "png",
      scale: 1,
    },
    screens: [
      {
        screenId: "button-primary",
        screenName: "Primary Button",
        storyTitle: "Components/Button/Primary",
        nodeId: "12:34",
        viewport: { width: 240, height: 160 },
        entryId: "components-button--primary",
        referenceNodeId: "12:34",
        referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        captureStrategy: "storybook_root_union",
        baselineCanvas: { width: 240, height: 160 },
        weight: 1,
      },
      {
        screenId: "button-secondary",
        screenName: "Secondary Button",
        storyTitle: "Components/Button/Secondary",
        nodeId: "12:35",
        viewport: { width: 240, height: 160 },
        entryId: "components-button--secondary",
        referenceNodeId: "12:35",
        referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        captureStrategy: "storybook_root_union",
        baselineCanvas: { width: 240, height: 160 },
        weight: 3,
      },
    ],
  };

  try {
    await writeBenchmarkFixture({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      metadata: componentMetadata,
    });

    const result = await runVisualBenchmark(
      {
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
      },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === "screen-fixture") {
            return {
              fixtureId,
              aggregateScore: 80,
              screens: [
                {
                  screenId: "2:10021",
                  screenName: "Screen Fixture",
                  nodeId: "2:10021",
                  status: "completed",
                  score: 80,
                  screenshotBuffer: createTestPngBuffer(
                    4,
                    4,
                    [255, 255, 255, 255],
                  ),
                  diffBuffer: null,
                  report: createCompletedVisualQualityReport(80),
                  viewport: { width: 1280, height: 720 },
                },
              ],
            };
          }

          return {
            fixtureId,
            aggregateScore: 87.5,
            componentAggregateScore: 87.5,
            componentCoverage: {
              comparedCount: 2,
              skippedCount: 0,
              coveragePercent: 100,
              bySkipReason: {},
            },
            screens: [
              {
                screenId: "button-primary",
                screenName: "Components/Button/Primary",
                nodeId: "12:34",
                status: "completed",
                score: 80,
                weight: 1,
                screenshotBuffer: createTestPngBuffer(
                  4,
                  4,
                  [255, 255, 255, 255],
                ),
                diffBuffer: null,
                report: createCompletedVisualQualityReport(80),
                viewport: { width: 240, height: 160 },
              },
              {
                screenId: "button-secondary",
                screenName: "Components/Button/Secondary",
                nodeId: "12:35",
                status: "completed",
                score: 90,
                weight: 3,
                screenshotBuffer: createTestPngBuffer(
                  4,
                  4,
                  [255, 255, 255, 255],
                ),
                diffBuffer: null,
                report: createCompletedVisualQualityReport(90),
                viewport: { width: 240, height: 160 },
              },
            ],
          };
        },
      },
    );

    assert.equal(result.componentAggregateScore, 87.5);
    assert.equal(result.overallCurrent, 82.25);
    const lastRun = await loadVisualBenchmarkLastRun({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
    });
    assert.equal(lastRun?.componentAggregateScore, 87.5);
    assert.equal(lastRun?.overallCurrent, 82.25);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark warns when headline score falls back to component-only results", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "component-fixture",
    version: 4,
    mode: "storybook_component",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "12:34",
      nodeName: "Component Fixture",
    },
    screens: [
      {
        screenId: "button-primary",
        screenName: "Primary Button",
        storyTitle: "Components/Button/Primary",
        nodeId: "12:34",
        viewport: { width: 240, height: 160 },
        entryId: "components-button--primary",
        referenceNodeId: "12:34",
        referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        captureStrategy: "storybook_root_union",
        baselineCanvas: { width: 240, height: 160 },
      },
    ],
  });

  try {
    const result = await runVisualBenchmark(
      {
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          aggregateScore: 91,
          componentAggregateScore: 91,
          componentCoverage: {
            comparedCount: 1,
            skippedCount: 0,
            coveragePercent: 100,
            bySkipReason: {},
          },
          screens: [
            {
              screenId: "button-primary",
              screenName: "Components/Button/Primary",
              nodeId: "12:34",
              status: "completed",
              score: 91,
              screenshotBuffer: createTestPngBuffer(4, 4, [255, 255, 255, 255]),
              diffBuffer: null,
              report: createCompletedVisualQualityReport(91),
              viewport: { width: 240, height: 160 },
            },
          ],
        }),
      },
    );

    assert.equal(result.screenAggregateScore, undefined);
    assert.equal(result.componentAggregateScore, 91);
    assert.equal(result.overallCurrent, 91);
    assert.ok(
      result.warnings?.includes(
        "Visual benchmark headline score used component results only because no full-page aggregate was available.",
      ),
    );
    const lastRun = await loadVisualBenchmarkLastRun({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
    });
    assert.ok(lastRun !== null);
    assert.equal(lastRun.overallScore, 91);
    assert.equal(lastRun.overallCurrent, 91);
    assert.equal(
      lastRun.warnings?.includes(
        "Visual benchmark headline score used component results only because no full-page aggregate was available.",
      ),
      true,
    );
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark computes headline delta against a like-for-like baseline blend", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "screen-fixture",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10031",
      nodeName: "Screen Fixture",
    },
  });
  const componentMetadata: VisualBenchmarkFixtureMetadata = {
    version: 4,
    mode: "storybook_component",
    fixtureId: "component-fixture",
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "12:34",
      nodeName: "Component Fixture",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: {
      width: 240,
      height: 160,
    },
    export: {
      format: "png",
      scale: 1,
    },
    screens: [
      {
        screenId: "button-primary",
        screenName: "Primary Button",
        storyTitle: "Components/Button/Primary",
        nodeId: "12:34",
        viewport: { width: 240, height: 160 },
        entryId: "components-button--primary",
        referenceNodeId: "12:34",
        referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
        captureStrategy: "storybook_root_union",
        baselineCanvas: { width: 240, height: 160 },
      },
    ],
  };

  try {
    await writeBenchmarkFixture({
      fixtureRoot: env.fixtureRoot,
      artifactRoot: env.artifactRoot,
      metadata: componentMetadata,
    });
    await saveVisualBenchmarkBaselineScores(
      [
        {
          fixtureId: "screen-fixture",
          screenId: "2:10031",
          screenName: "Screen Fixture",
          score: 80,
        },
        {
          fixtureId: "component-fixture",
          screenId: "button-primary",
          screenName: "Primary Button",
          score: 50,
        },
      ],
      {
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
      },
    );

    const result = await runVisualBenchmark(
      {
        fixtureRoot: env.fixtureRoot,
        artifactRoot: env.artifactRoot,
      },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === "screen-fixture") {
            return {
              fixtureId,
              aggregateScore: 90,
              screens: [
                {
                  screenId: "2:10031",
                  screenName: "Screen Fixture",
                  nodeId: "2:10031",
                  status: "completed",
                  score: 90,
                  screenshotBuffer: createTestPngBuffer(
                    4,
                    4,
                    [255, 255, 255, 255],
                  ),
                  diffBuffer: null,
                  report: createCompletedVisualQualityReport(90),
                  viewport: { width: 1280, height: 720 },
                },
              ],
            };
          }

          return {
            fixtureId,
            aggregateScore: null,
            componentAggregateScore: null,
            componentCoverage: {
              comparedCount: 0,
              skippedCount: 1,
              coveragePercent: 0,
              bySkipReason: { missing_capture: 1 },
            },
            screens: [
              {
                screenId: "button-primary",
                screenName: "Primary Button",
                nodeId: "12:34",
                status: "skipped",
                skipReason: "missing_capture",
                viewport: { width: 240, height: 160 },
              },
            ],
          };
        },
      },
    );

    assert.equal(result.overallCurrent, 90);
    assert.equal(result.overallBaseline, 80);
    assert.equal(result.overallDelta, 10);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("formatVisualBenchmarkTable shows screen-specific view labels for multi-screen deltas", () => {
  const table = formatVisualBenchmarkTable({
    deltas: [
      {
        fixtureId: "multi-screen",
        screenId: "2:10001",
        screenName: "Home",
        baseline: 80,
        current: 90,
        delta: 10,
        indicator: "improved",
      },
      {
        fixtureId: "multi-screen",
        screenId: "2:10002",
        screenName: "Settings",
        baseline: 75,
        current: 70,
        delta: -5,
        indicator: "degraded",
      },
    ],
    overallBaseline: 77.5,
    overallCurrent: 80,
    overallDelta: 2.5,
    alerts: [],
    trendSummaries: [],
  });
  assert.match(table, /Multi Screen \/ Home/);
  assert.match(table, /Multi Screen \/ Settings/);
});

test("computeVisualBenchmarkDeltas uses composite key so two screens with same fixtureId do not collide", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    {
      fixtureId: "multi",
      screenId: "2:10001",
      screenName: "Home",
      score: 90,
    },
    {
      fixtureId: "multi",
      screenId: "2:10002",
      screenName: "Settings",
      score: 70,
    },
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: [
      {
        fixtureId: "multi",
        screenId: "2:10001",
        screenName: "Home",
        score: 85,
      },
      {
        fixtureId: "multi",
        screenId: "2:10002",
        screenName: "Settings",
        score: 75,
      },
    ],
  };
  const result = computeVisualBenchmarkDeltas(current, baseline);
  assert.equal(result.deltas.length, 2);
  const home = result.deltas.find((delta) => delta.screenId === "2:10001");
  const settings = result.deltas.find((delta) => delta.screenId === "2:10002");
  assert.ok(home);
  assert.ok(settings);
  assert.equal(home.baseline, 85);
  assert.equal(home.current, 90);
  assert.equal(home.delta, 5);
  assert.equal(settings.baseline, 75);
  assert.equal(settings.current, 70);
  assert.equal(settings.delta, -5);
});

test("runVisualBenchmark artifact save uses composite key and does not collide on multi-screen fixtures", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "artifact-multi",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Home",
    },
  });
  try {
    await writeVisualBenchmarkFixtureMetadata(
      "artifact-multi",
      {
        version: 2,
        fixtureId: "artifact-multi",
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "2:10001",
          nodeName: "Fixture Root",
          lastModified: "2026-03-30T20:59:16Z",
        },
        viewport: { width: 1280, height: 720 },
        export: { format: "png", scale: 2 },
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            nodeId: "2:10001",
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            nodeId: "2:10002",
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      { fixtureRoot: env.fixtureRoot },
    );
    const staleLegacyArtifactDir = path.join(
      env.artifactRoot,
      "last-run",
      "artifact-multi",
    );
    await mkdir(staleLegacyArtifactDir, { recursive: true });
    await writeFile(
      path.join(staleLegacyArtifactDir, "actual.png"),
      createTestPngBuffer(2, 2, [10, 20, 30, 255]),
    );
    await writeFile(
      path.join(staleLegacyArtifactDir, "diff.png"),
      createTestPngBuffer(2, 2, [30, 20, 10, 255]),
    );
    await writeFile(
      path.join(staleLegacyArtifactDir, "manifest.json"),
      "{}",
      "utf8",
    );
    await writeFile(
      path.join(staleLegacyArtifactDir, "report.json"),
      "{}",
      "utf8",
    );

    await runVisualBenchmark(
      {
        ...env,
        qualityConfig: {
          thresholds: { warn: 95 },
        },
      },
      {
        executeFixture: async (fixtureId) => ({
          fixtureId,
          aggregateScore: 50,
          screens: [
            {
              screenId: "2:10001",
              screenName: "Home",
              score: 50,
              screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
              diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
              report: createCompletedVisualQualityReport(50),
              viewport: { width: 1280, height: 720 },
            },
            {
              screenId: "2:10002",
              screenName: "Settings",
              score: 50,
              screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
              diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
              report: createCompletedVisualQualityReport(50),
              viewport: { width: 1280, height: 720 },
            },
          ],
        }),
      },
    );

    // Each screen's artifact manifest should exist separately with its own thresholdResult populated
    const firstArtifact = await loadVisualBenchmarkLastRunArtifact(
      "artifact-multi",
      env,
    );
    assert.ok(
      firstArtifact,
      "multi-screen fixture should have a loadable artifact",
    );
    // Key point: threshold result must NOT be undefined — that's the H4 collision manifesting
    assert.ok(
      firstArtifact.thresholdResult !== undefined,
      "multi-screen fixture artifact must have its thresholdResult populated (H4 composite key fix)",
    );
    const staleLegacyFiles = [
      "actual.png",
      "diff.png",
      "manifest.json",
      "report.json",
    ] as const;
    for (const fileName of staleLegacyFiles) {
      await assert.rejects(
        readFile(path.join(staleLegacyArtifactDir, fileName)),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT",
      );
    }
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark persists browser-aware last-run metadata and artifact manifests as v2", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "browser-aware",
  });
  try {
    const makeBrowserArtifact = (
      browser: "chromium" | "firefox" | "webkit",
      score: number,
      rgba: readonly [number, number, number, number],
    ) => ({
      browser,
      viewportId: "desktop",
      viewportLabel: "Desktop",
      score,
      screenshotBuffer: createTestPngBuffer(4, 4, rgba),
      diffBuffer: createTestPngBuffer(4, 4, [255, 0, 0, 255]),
      report: {
        ...createCompletedVisualQualityReport(score),
        overallScore: score,
      },
      viewport: { width: 1280, height: 720 },
    });

    await runVisualBenchmark(env, {
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 94,
        browserBreakdown: {
          chromium: 96,
          firefox: 94,
          webkit: 92,
        },
        crossBrowserConsistency: {
          browsers: ["chromium", "firefox", "webkit"],
          consistencyScore: 93,
          warnings: ["firefox differs from chromium by 6%."],
          pairwiseDiffs: [
            {
              browserA: "chromium",
              browserB: "firefox",
              diffPercent: 6,
              diffBuffer: createTestPngBuffer(4, 4, [255, 128, 0, 255]),
            },
            {
              browserA: "chromium",
              browserB: "webkit",
              diffPercent: 8,
              diffBuffer: createTestPngBuffer(4, 4, [255, 64, 0, 255]),
            },
            {
              browserA: "firefox",
              browserB: "webkit",
              diffPercent: 4,
              diffBuffer: createTestPngBuffer(4, 4, [255, 32, 0, 255]),
            },
          ],
        },
        screens: [
          {
            screenId: simpleFormMetadata.source.nodeId,
            screenName: simpleFormMetadata.source.nodeName,
            score: 94,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: {
              ...createCompletedVisualQualityReport(94),
              overallScore: 94,
              browserBreakdown: {
                chromium: 96,
                firefox: 94,
                webkit: 92,
              },
              crossBrowserConsistency: {
                browsers: ["chromium", "firefox", "webkit"],
                consistencyScore: 93,
                warnings: ["firefox differs from chromium by 6%."],
                pairwiseDiffs: [
                  {
                    browserA: "chromium",
                    browserB: "firefox",
                    diffPercent: 6,
                    diffImagePath:
                      "visual-quality/pairwise/chromium-vs-firefox.png",
                  },
                ],
              },
              perBrowser: [
                {
                  browser: "chromium",
                  overallScore: 96,
                  actualImagePath:
                    "visual-quality/browsers/chromium/actual.png",
                  diffImagePath: "visual-quality/browsers/chromium/diff.png",
                  reportPath: "visual-quality/browsers/chromium/report.json",
                },
              ],
            },
            viewport: { width: 1280, height: 720 },
            browserArtifacts: [
              makeBrowserArtifact("chromium", 96, [250, 250, 250, 255]),
              makeBrowserArtifact("firefox", 94, [245, 245, 245, 255]),
              makeBrowserArtifact("webkit", 92, [240, 240, 240, 255]),
            ],
            crossBrowserConsistency: {
              browsers: ["chromium", "firefox", "webkit"],
              consistencyScore: 93,
              warnings: ["firefox differs from chromium by 6%."],
              pairwiseDiffs: [
                {
                  browserA: "chromium",
                  browserB: "firefox",
                  diffPercent: 6,
                  diffBuffer: createTestPngBuffer(4, 4, [255, 128, 0, 255]),
                },
                {
                  browserA: "chromium",
                  browserB: "webkit",
                  diffPercent: 8,
                  diffBuffer: createTestPngBuffer(4, 4, [255, 64, 0, 255]),
                },
                {
                  browserA: "firefox",
                  browserB: "webkit",
                  diffPercent: 4,
                  diffBuffer: createTestPngBuffer(4, 4, [255, 32, 0, 255]),
                },
              ],
            },
          },
        ],
      }),
    });

    const rawLastRun = JSON.parse(
      await readFile(path.join(env.artifactRoot, "last-run.json"), "utf8"),
    ) as {
      version: number;
      browserBreakdown?: Record<string, number>;
      crossBrowserConsistency?: { pairwiseDiffs: unknown[] };
    };
    assert.equal(rawLastRun.version, 2);
    assert.deepEqual(rawLastRun.browserBreakdown, {
      chromium: 96,
      firefox: 94,
      webkit: 92,
    });
    assert.equal(rawLastRun.crossBrowserConsistency?.pairwiseDiffs.length, 3);

    const lastRun = await loadVisualBenchmarkLastRun(env);
    assert.equal(lastRun?.version, 2);
    assert.deepEqual(lastRun?.browserBreakdown, {
      chromium: 96,
      firefox: 94,
      webkit: 92,
    });
    assert.equal(lastRun?.crossBrowserConsistency?.pairwiseDiffs.length, 3);

    const artifact = await loadVisualBenchmarkLastRunArtifact(
      "browser-aware",
      env,
    );
    assert.ok(artifact);
    assert.equal(artifact?.version, 2);
    assert.deepEqual(artifact?.browserBreakdown, {
      chromium: 96,
      firefox: 94,
      webkit: 92,
    });
    assert.equal(artifact?.perBrowser?.length, 3);
    assert.equal(artifact?.crossBrowserConsistency?.pairwiseDiffs.length, 3);

    for (const entry of artifact?.perBrowser ?? []) {
      if (entry.actualImagePath) {
        await readFile(path.resolve(process.cwd(), entry.actualImagePath));
      }
      if (entry.diffImagePath) {
        await readFile(path.resolve(process.cwd(), entry.diffImagePath));
      }
      if (entry.reportPath) {
        await readFile(path.resolve(process.cwd(), entry.reportPath), "utf8");
      }
    }
    for (const pair of artifact?.crossBrowserConsistency?.pairwiseDiffs ?? []) {
      if (pair.diffImagePath) {
        await readFile(path.resolve(process.cwd(), pair.diffImagePath));
      }
    }
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("saveVisualBenchmarkLastRunArtifact removes stale browser and pairwise artifacts on rerun", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "browser-aware-rerun",
  });
  try {
    const artifactBaseInput = {
      fixtureId: "browser-aware-rerun",
      screenId: simpleFormMetadata.source.nodeId,
      screenName: simpleFormMetadata.source.nodeName,
      viewportId: "desktop",
      viewportLabel: "Desktop",
      score: 96,
      ranAt: "2026-04-11T12:00:00.000Z",
      viewport: { width: 1280, height: 720 },
      actualImageBuffer: createTestPngBuffer(4, 4, [240, 240, 240, 255]),
      diffImageBuffer: createTestPngBuffer(4, 4, [64, 64, 64, 255]),
      report: createCompletedVisualQualityReport(96),
    } as const;

    await saveVisualBenchmarkLastRunArtifact(
      {
        ...artifactBaseInput,
        browserArtifacts: [
          {
            browser: "chromium",
            viewportId: "desktop",
            viewportLabel: "Desktop",
            score: 97,
            screenshotBuffer: createTestPngBuffer(4, 4, [255, 255, 255, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [255, 0, 0, 255]),
            report: createCompletedVisualQualityReport(97),
            viewport: { width: 1280, height: 720 },
          },
          {
            browser: "firefox",
            viewportId: "desktop",
            viewportLabel: "Desktop",
            score: 95,
            screenshotBuffer: createTestPngBuffer(4, 4, [250, 250, 250, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [255, 64, 0, 255]),
            report: createCompletedVisualQualityReport(95),
            viewport: { width: 1280, height: 720 },
          },
        ],
        crossBrowserConsistency: {
          browsers: ["chromium", "firefox"],
          consistencyScore: 94,
          warnings: ["chromium vs firefox: rendering differs by 6%"],
          pairwiseDiffs: [
            {
              browserA: "chromium",
              browserB: "firefox",
              diffPercent: 6,
              diffBuffer: createTestPngBuffer(4, 4, [255, 128, 0, 255]),
            },
          ],
        },
      },
      env,
    );

    const artifactDir = path.join(
      env.artifactRoot,
      "last-run",
      "browser-aware-rerun",
      "screens",
      "1_65671",
      "desktop",
    );
    await readFile(path.join(artifactDir, "browsers", "firefox", "actual.png"));
    await readFile(
      path.join(artifactDir, "pairwise", "chromium-vs-firefox.png"),
    );

    await saveVisualBenchmarkLastRunArtifact(
      {
        ...artifactBaseInput,
        score: 98,
        browserArtifacts: [
          {
            browser: "chromium",
            viewportId: "desktop",
            viewportLabel: "Desktop",
            score: 98,
            screenshotBuffer: createTestPngBuffer(4, 4, [248, 248, 248, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [0, 255, 0, 255]),
            report: createCompletedVisualQualityReport(98),
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      env,
    );

    await assert.rejects(
      readFile(path.join(artifactDir, "browsers", "firefox", "actual.png")),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    await assert.rejects(
      readFile(path.join(artifactDir, "pairwise", "chromium-vs-firefox.png")),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT",
    );

    const rerunArtifact = await loadVisualBenchmarkLastRunArtifact(
      "browser-aware-rerun",
      env,
    );
    assert.ok(rerunArtifact);
    assert.deepEqual(rerunArtifact?.browserBreakdown, { chromium: 98 });
    assert.equal(rerunArtifact?.perBrowser?.length, 1);
    assert.equal(rerunArtifact?.crossBrowserConsistency, undefined);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark emits ALERT_VISUAL_QUALITY_MISSING_SCREEN when metadata screens exceed baseline screens", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "missing-screen",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Home",
    },
  });
  try {
    await writeVisualBenchmarkFixtureMetadata(
      "missing-screen",
      {
        version: 2,
        fixtureId: "missing-screen",
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "2:10001",
          nodeName: "Fixture Root",
          lastModified: "2026-03-30T20:59:16Z",
        },
        viewport: { width: 1280, height: 720 },
        export: { format: "png", scale: 2 },
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            nodeId: "2:10001",
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            nodeId: "2:10002",
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      { fixtureRoot: env.fixtureRoot },
    );

    // Baseline only has the first screen — second screen is "missing" from baseline
    await saveVisualBenchmarkBaseline(
      {
        deltas: [
          {
            fixtureId: "missing-screen",
            screenId: "2:10001",
            screenName: "Home",
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
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 88,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            score: 90,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(90),
            viewport: { width: 1280, height: 720 },
          },
          {
            screenId: "2:10002",
            screenName: "Settings",
            score: 86,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(86),
            viewport: { width: 1280, height: 720 },
          },
        ],
      }),
    });

    const missing = result.alerts.find(
      (alert) => alert.code === "ALERT_VISUAL_QUALITY_MISSING_SCREEN",
    );
    assert.ok(missing, "missing-screen alert should be emitted");
    assert.equal(missing.severity, "warn");
    assert.ok(missing.message.includes("missing-screen"));
    assert.ok(missing.message.includes("2:10002"));
    assert.equal(missing.value, 1);
    assert.equal(missing.threshold, 0);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark emits ALERT_VISUAL_QUALITY_ORPHAN_SCREEN_BASELINE when baseline has a screen metadata does not", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "orphan-screen",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Home",
    },
  });
  try {
    await writeVisualBenchmarkFixtureMetadata(
      "orphan-screen",
      {
        version: 2,
        fixtureId: "orphan-screen",
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "2:10001",
          nodeName: "Fixture Root",
          lastModified: "2026-03-30T20:59:16Z",
        },
        viewport: { width: 1280, height: 720 },
        export: { format: "png", scale: 2 },
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            nodeId: "2:10001",
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      { fixtureRoot: env.fixtureRoot },
    );

    // Baseline has an extra screen "2:99999" not declared in metadata
    await saveVisualBenchmarkBaselineScores(
      [
        {
          fixtureId: "orphan-screen",
          screenId: "2:10001",
          screenName: "Home",
          score: 90,
        },
        {
          fixtureId: "orphan-screen",
          screenId: "2:99999",
          screenName: "Ghost",
          score: 80,
        },
      ],
      env,
    );

    const result = await runVisualBenchmark(env, {
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 90,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            score: 90,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(90),
            viewport: { width: 1280, height: 720 },
          },
        ],
      }),
    });

    const orphan = result.alerts.find(
      (alert) => alert.code === "ALERT_VISUAL_QUALITY_ORPHAN_SCREEN_BASELINE",
    );
    assert.ok(orphan, "orphan-baseline-screen alert should be emitted");
    assert.equal(orphan.severity, "warn");
    assert.ok(orphan.message.includes("orphan-screen"));
    assert.ok(orphan.message.includes("2:99999"));
    assert.equal(orphan.value, 1);
    assert.equal(orphan.threshold, 0);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark emits ALERT_VISUAL_QUALITY_STALE_SCREEN_BASELINE when baseline captured date is older than metadata capturedAt", async () => {
  const env = await createBenchmarkFixtureEnvironment({
    fixtureId: "stale-screen",
    source: {
      ...simpleFormMetadata.source,
      nodeId: "2:10001",
      nodeName: "Home",
    },
  });
  try {
    // Upgrade metadata with capturedAt that is newer than baseline's updatedAt
    await writeVisualBenchmarkFixtureMetadata(
      "stale-screen",
      {
        version: 2,
        fixtureId: "stale-screen",
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "2:10001",
          nodeName: "Fixture Root",
          lastModified: "2026-04-09T00:00:00.000Z",
        },
        viewport: { width: 1280, height: 720 },
        export: { format: "png", scale: 2 },
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            nodeId: "2:10001",
            viewport: { width: 1280, height: 720 },
          },
        ],
      },
      { fixtureRoot: env.fixtureRoot },
    );

    // Write baseline manually with an old updatedAt marker older than metadata.capturedAt.
    // Phase 1 baseline v3 schema does not track per-screen updatedAt, so we use the
    // file mtime. Write the file first, then rewind mtime via utimes.
    const { utimes } = await import("node:fs/promises");
    await saveVisualBenchmarkBaselineScores(
      [
        {
          fixtureId: "stale-screen",
          screenId: "2:10001",
          screenName: "Home",
          score: 90,
        },
      ],
      env,
    );
    const staleTime = new Date("2026-01-01T00:00:00.000Z");
    await utimes(
      path.join(env.fixtureRoot, "baseline.json"),
      staleTime,
      staleTime,
    );

    const result = await runVisualBenchmark(env, {
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 90,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home",
            score: 90,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(90),
            viewport: { width: 1280, height: 720 },
          },
        ],
      }),
    });

    const stale = result.alerts.find(
      (alert) => alert.code === "ALERT_VISUAL_QUALITY_STALE_SCREEN_BASELINE",
    );
    assert.ok(stale, "stale-baseline alert should be emitted");
    assert.equal(stale.severity, "warn");
    assert.ok(stale.message.includes("stale-screen"));
    assert.equal(stale.value, 1);
    assert.equal(stale.threshold, 0);
  } finally {
    await rm(path.dirname(env.fixtureRoot), { recursive: true, force: true });
  }
});

test("runVisualBenchmark single-screen fixture emits byte-identical last-run.json under v1 and v2 metadata", async () => {
  const createEnv = async (
    metadataVersion: 1 | 2,
  ): Promise<{
    env: Awaited<ReturnType<typeof createBenchmarkFixtureEnvironment>>;
    lastRunJson: string;
  }> => {
    const env = await createBenchmarkFixtureEnvironment({
      fixtureId: "equivalence-fixture",
      source: {
        ...simpleFormMetadata.source,
        nodeId: "2:10001",
        nodeName: "Home Screen",
      },
    });

    if (metadataVersion === 2) {
      await writeVisualBenchmarkFixtureMetadata(
        "equivalence-fixture",
        {
          version: 2,
          fixtureId: "equivalence-fixture",
          capturedAt: "2026-04-09T00:00:00.000Z",
          source: {
            fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
            nodeId: "2:10001",
            nodeName: "Home Screen",
            lastModified: "2026-03-30T20:59:16Z",
          },
          viewport: { width: 1336, height: 1578 },
          export: { format: "png", scale: 2 },
          screens: [
            {
              screenId: "2:10001",
              screenName: "Home Screen",
              nodeId: "2:10001",
              viewport: { width: 1336, height: 1578 },
            },
          ],
        },
        { fixtureRoot: env.fixtureRoot },
      );
    }

    await runVisualBenchmark(env, {
      executeFixture: async (fixtureId) => ({
        fixtureId,
        aggregateScore: 92,
        screens: [
          {
            screenId: "2:10001",
            screenName: "Home Screen",
            score: 92,
            screenshotBuffer: createTestPngBuffer(4, 4, [100, 100, 100, 255]),
            diffBuffer: createTestPngBuffer(4, 4, [50, 50, 50, 255]),
            report: createCompletedVisualQualityReport(92),
            viewport: { width: 1336, height: 1578 },
          },
        ],
      }),
    });

    const lastRun = JSON.parse(
      await readFile(path.join(env.artifactRoot, "last-run.json"), "utf8"),
    ) as { scores: VisualBenchmarkScoreEntry[] };
    // Normalize ranAt which varies per run
    return {
      env,
      lastRunJson: JSON.stringify(lastRun.scores),
    };
  };

  const v1 = await createEnv(1);
  const v2 = await createEnv(2);
  try {
    assert.equal(
      v1.lastRunJson,
      v2.lastRunJson,
      "single-screen v1 and v2 metadata must produce byte-identical score lists",
    );
  } finally {
    await rm(path.dirname(v1.env.fixtureRoot), {
      recursive: true,
      force: true,
    });
    await rm(path.dirname(v2.env.fixtureRoot), {
      recursive: true,
      force: true,
    });
  }
});

test("fetchWithRetry does not retry 4xx responses (M3 fix)", async () => {
  const { fetchVisualBenchmarkNodeSnapshot } =
    await import("./visual-benchmark.update.js");
  let attempts = 0;
  await assert.rejects(async () => {
    await fetchVisualBenchmarkNodeSnapshot(simpleFormMetadata, "bad-token", {
      fetchImpl: async () => {
        attempts += 1;
        return new Response("Forbidden", {
          status: 403,
          statusText: "Forbidden",
        });
      },
    });
  }, /403|Forbidden|Figma API/i);
  assert.equal(attempts, 1, "4xx must not be retried");
});

test("fetchWithRetry retries 5xx responses and throws a defined error on exhaustion (M3 fix)", async () => {
  const { fetchVisualBenchmarkNodeSnapshot } =
    await import("./visual-benchmark.update.js");
  let attempts = 0;
  await assert.rejects(
    async () => {
      await fetchVisualBenchmarkNodeSnapshot(simpleFormMetadata, "good-token", {
        fetchImpl: async () => {
          attempts += 1;
          return new Response("Server Error", {
            status: 503,
            statusText: "Service Unavailable",
          });
        },
      });
    },
    (error: unknown) => error instanceof Error,
    "final throw must be a defined Error (not undefined)",
  );
  assert.ok(
    attempts >= 2,
    `5xx must retry at least once, got ${attempts} attempts`,
  );
});

test('getVisualBenchmarkScoreKey returns "fixture::screen::default" when viewportId missing', () => {
  assert.equal(
    getVisualBenchmarkScoreKey({
      fixtureId: "simple-form",
      screenId: "home",
    }),
    "simple-form::home::default",
  );
});

test('getVisualBenchmarkScoreKey returns "fixture::screen::mobile" when viewportId set', () => {
  assert.equal(
    getVisualBenchmarkScoreKey({
      fixtureId: "simple-form",
      screenId: "home",
      viewportId: "mobile",
    }),
    "simple-form::home::mobile",
  );
});

test("getVisualBenchmarkScoreKey uses fixtureId as screenId fallback", () => {
  assert.equal(
    getVisualBenchmarkScoreKey({
      fixtureId: "simple-form",
    }),
    "simple-form::simple-form::default",
  );
});
