import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  assertAllowedFixtureId,
  assertAllowedFixturePath,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureBundle,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference
} from "./visual-benchmark.helpers.js";
import {
  fetchVisualBenchmarkNodeSnapshot,
  fetchVisualBenchmarkReferenceImage,
  resolveVisualBenchmarkMaintenanceMode,
  runVisualBenchmarkLiveAudit
} from "./visual-benchmark.update.js";
import {
  resolveVisualBenchmarkCliResolution,
  runVisualBenchmarkCli
} from "./visual-benchmark.cli.js";
import {
  computeVisualBenchmarkDeltas,
  computeVisualBenchmarkScores,
  formatVisualBenchmarkTable,
  loadVisualBenchmarkBaseline,
  saveVisualBenchmarkBaseline,
  type VisualBenchmarkBaseline,
  type VisualBenchmarkResult,
  type VisualBenchmarkScoreEntry
} from "./visual-benchmark-runner.js";

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
    fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
    nodeId: "1:65671",
    nodeName: "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
    lastModified: "2026-03-30T20:59:16Z"
  },
  viewport: {
    width: 1336,
    height: 1578
  },
  export: {
    format: "png",
    scale: 2
  }
};

const createFixtureRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-benchmark-"));
  const fixtureDir = path.join(root, "simple-form");
  await mkdir(fixtureDir, { recursive: true });
  await writeVisualBenchmarkFixtureMetadata("simple-form", simpleFormMetadata, { fixtureRoot: root });
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
              height: simpleFormMetadata.viewport.height
            }
          }
        }
      }
    },
    { fixtureRoot: root }
  );
  await writeVisualBenchmarkReference("simple-form", createTestPngBuffer(8, 8, [0, 100, 200, 255]), { fixtureRoot: root });
  return root;
};

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
          height: 900
        }
      }
    }
  }
};

const createJsonResponse = (value: unknown): Response => {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

test("listVisualBenchmarkFixtureIds returns at least one fixture", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  assert.ok(ids.length > 0, "Expected at least one visual-benchmark fixture.");
  assert.ok(ids.includes("simple-form"), "Expected 'simple-form' fixture to be present.");
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

test("loadVisualBenchmarkFixtureInputs reads figma.json for simple-form", async () => {
  const figmaInput = await loadVisualBenchmarkFixtureInputs("simple-form");
  assert.ok(typeof figmaInput === "object" && figmaInput !== null, "Expected figmaInput to be an object.");
  const nodes = (figmaInput as Record<string, unknown>).nodes;
  assert.ok(typeof nodes === "object" && nodes !== null, "Expected figmaInput.nodes to be an object.");
  assert.ok(Object.hasOwn(nodes as Record<string, unknown>, "1:65671"), "Expected live node id to be present.");
});

test("loadVisualBenchmarkReference reads a valid PNG for the committed fixture", async () => {
  const buffer = await loadVisualBenchmarkReference("simple-form");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.ok(isValidPngBuffer(buffer));
});

test("loadVisualBenchmarkFixtureBundle loads the flat fixture bundle", async () => {
  const bundle = await loadVisualBenchmarkFixtureBundle("simple-form");
  assert.equal(bundle.metadata.fixtureId, "simple-form");
  assert.ok(typeof bundle.figmaInput === "object" && bundle.figmaInput !== null);
  assert.ok(bundle.referenceBuffer.length > 0);
});

test("assertAllowedFixtureId and assertAllowedFixturePath reject invalid inputs", () => {
  assert.throws(() => assertAllowedFixturePath(""), { message: "Fixture path must not be empty." });
  assert.throws(() => assertAllowedFixturePath("/absolute/path"), { message: /must be relative/ });
  assert.throws(() => assertAllowedFixturePath("../escape/path"), { message: /contains forbidden segment/ });
  assert.throws(() => assertAllowedFixturePath("path/with/../traversal"), { message: /contains forbidden segment/ });
  assert.throws(() => assertAllowedFixturePath("path/to/file.zip"), { message: /contains forbidden segment/ });
  assert.throws(() => assertAllowedFixturePath("storybook-static/thing"), { message: /contains forbidden segment/ });
  assert.throws(() => assertAllowedFixtureId("nested/fixture"), { message: /must not contain path separators/ });

  assert.equal(assertAllowedFixtureId("simple-form"), "simple-form");
  assert.equal(assertAllowedFixturePath("inputs/figma.json"), "inputs/figma.json");
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
      }
    }
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
  await assert.rejects(
    async () => {
      await fetchVisualBenchmarkReferenceImage(
        simpleFormMetadata,
        "test-token",
        {
          fetchImpl: async () => createJsonResponse({
            err: null,
            images: {
              "1:65671": null
            }
          })
        }
      );
    },
    /no renderable image/
  );
});

test("fetchVisualBenchmarkReferenceImage fails when the downloaded asset is not a PNG", async () => {
  let callIndex = 0;
  await assert.rejects(
    async () => {
      await fetchVisualBenchmarkReferenceImage(
        simpleFormMetadata,
        "test-token",
        {
          fetchImpl: async () => {
            callIndex += 1;
            if (callIndex === 1) {
              return createJsonResponse({
                err: null,
                images: {
                  "1:65671": "https://example.test/reference.png"
                }
              });
            }
            return new Response("not-a-png", { status: 200 });
          }
        }
      );
    },
    /invalid PNG/
  );
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
              "1:65671": "https://example.test/reference.png"
            }
          });
        }
        return new Response(createTestPngBuffer(8, 8, [255, 0, 0, 255]), { status: 200 });
      },
      log: () => {
        return;
      }
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
  assert.equal(resolveVisualBenchmarkMaintenanceMode(["--update-fixtures"]), "update-fixtures");
  assert.equal(resolveVisualBenchmarkMaintenanceMode(["--update-references"]), "update-references");
  assert.equal(resolveVisualBenchmarkMaintenanceMode(["--live"]), "live");
  assert.throws(
    () => resolveVisualBenchmarkMaintenanceMode([]),
    /Usage: visual-benchmark.update.ts/
  );
  assert.throws(
    () => resolveVisualBenchmarkMaintenanceMode(["--update-fixtures", "--live"]),
    /Usage: visual-benchmark.update.ts/
  );
});

test("resolveVisualBenchmarkCliResolution routes default mode to tests and flags to maintenance", () => {
  assert.deepEqual(resolveVisualBenchmarkCliResolution([]), {
    action: "test",
    forwardedArgs: []
  });
  assert.deepEqual(resolveVisualBenchmarkCliResolution(["--update-fixtures"]), {
    action: "maintenance",
    forwardedArgs: ["--update-fixtures"]
  });
  assert.throws(
    () => resolveVisualBenchmarkCliResolution(["--invalid"]),
    /Usage: pnpm benchmark:visual/
  );
});

test("runVisualBenchmarkCli spawns the benchmark test suite in default mode", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const status = await runVisualBenchmarkCli([], {
    spawnCommand: (command, args) => {
      calls.push({ command, args });
      return {
        status: 0,
        signal: null,
        output: [],
        pid: 0,
        stdout: null,
        stderr: null
      } as never;
    }
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "pnpm");
  assert.deepEqual(calls[0]?.args, ["exec", "tsx", "--test", "integration/visual-benchmark.test.ts"]);
});

test("helper store writes stable fixture JSON in sorted key order", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-benchmark-stable-"));
  try {
    await mkdir(path.join(fixtureRoot, "stable"), { recursive: true });
    await writeVisualBenchmarkFixtureInputs(
      "stable",
      {
        zeta: 1,
        alpha: {
          beta: 2,
          aardvark: 1
        }
      },
      { fixtureRoot }
    );

    const stored = await loadVisualBenchmarkFixtureInputs("stable", { fixtureRoot });
    assert.equal(
      toStableJsonString(stored),
      "{\n  \"alpha\": {\n    \"aardvark\": 1,\n    \"beta\": 2\n  },\n  \"zeta\": 1\n}\n"
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("listVisualBenchmarkFixtureIds returns all 5 fixture IDs", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  assert.ok(ids.includes("simple-form"), "Expected 'simple-form' fixture.");
  assert.ok(ids.includes("complex-dashboard"), "Expected 'complex-dashboard' fixture.");
  assert.ok(ids.includes("data-table"), "Expected 'data-table' fixture.");
  assert.ok(ids.includes("navigation-sidebar"), "Expected 'navigation-sidebar' fixture.");
  assert.ok(ids.includes("design-system-showcase"), "Expected 'design-system-showcase' fixture.");
  assert.equal(ids.length, 5, "Expected exactly 5 fixture IDs.");
});

test("all 5 fixtures can be loaded (metadata, figma.json, reference.png)", async () => {
  const ids = await listVisualBenchmarkFixtureIds();
  for (const id of ids) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(id);
    assert.equal(metadata.version, 1);
    assert.equal(metadata.fixtureId, id);
    assert.equal(metadata.source.fileKey, "DUArQ8VuM3aPMjXFLaQSSH");
    assert.ok(metadata.viewport.width > 0);
    assert.ok(metadata.viewport.height > 0);

    const figmaInput = await loadVisualBenchmarkFixtureInputs(id);
    assert.ok(typeof figmaInput === "object" && figmaInput !== null, `Expected figmaInput for '${id}' to be an object.`);

    const reference = await loadVisualBenchmarkReference(id);
    assert.ok(Buffer.isBuffer(reference));
    assert.ok(isValidPngBuffer(reference), `Expected valid PNG for '${id}'.`);
  }
});

test("computeVisualBenchmarkScores returns a score for each fixture", async () => {
  const scores = await computeVisualBenchmarkScores();
  assert.equal(scores.length, 5, "Expected scores for all 5 fixtures.");
  for (const entry of scores) {
    assert.ok(typeof entry.fixtureId === "string" && entry.fixtureId.length > 0);
    assert.equal(entry.score, 100, `Expected self-comparison score of 100 for '${entry.fixtureId}'.`);
  }
});

test("computeVisualBenchmarkDeltas with baseline computes correct deltas", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", score: 95 },
    { fixtureId: "fixture-b", score: 80 },
    { fixtureId: "fixture-c", score: 100 }
  ];
  const baseline: VisualBenchmarkBaseline = {
    version: 1,
    updatedAt: "2026-04-01T00:00:00.000Z",
    scores: [
      { fixtureId: "fixture-a", score: 90 },
      { fixtureId: "fixture-b", score: 85 },
      { fixtureId: "fixture-c", score: 100 }
    ]
  };
  const result = computeVisualBenchmarkDeltas(current, baseline);
  assert.equal(result.deltas.length, 3);

  const deltaA = result.deltas.find((d) => d.fixtureId === "fixture-a");
  assert.ok(deltaA);
  assert.equal(deltaA.baseline, 90);
  assert.equal(deltaA.current, 95);
  assert.equal(deltaA.delta, 5);
  assert.equal(deltaA.indicator, "improved");

  const deltaB = result.deltas.find((d) => d.fixtureId === "fixture-b");
  assert.ok(deltaB);
  assert.equal(deltaB.baseline, 85);
  assert.equal(deltaB.current, 80);
  assert.equal(deltaB.delta, -5);
  assert.equal(deltaB.indicator, "degraded");

  const deltaC = result.deltas.find((d) => d.fixtureId === "fixture-c");
  assert.ok(deltaC);
  assert.equal(deltaC.baseline, 100);
  assert.equal(deltaC.current, 100);
  assert.equal(deltaC.delta, 0);
  assert.equal(deltaC.indicator, "neutral");
});

test("computeVisualBenchmarkDeltas with null baseline returns null deltas", () => {
  const current: VisualBenchmarkScoreEntry[] = [
    { fixtureId: "fixture-a", score: 88 }
  ];
  const result = computeVisualBenchmarkDeltas(current, null);
  assert.equal(result.deltas.length, 1);
  assert.equal(result.deltas[0]?.baseline, null);
  assert.equal(result.deltas[0]?.delta, null);
  assert.equal(result.deltas[0]?.indicator, "neutral");
  assert.equal(result.overallBaseline, null);
  assert.equal(result.overallDelta, null);
  assert.equal(result.overallCurrent, 88);
});

test("formatVisualBenchmarkTable produces a table with expected structure", () => {
  const result: VisualBenchmarkResult = {
    deltas: [
      { fixtureId: "simple-form", baseline: 85, current: 88, delta: 3, indicator: "improved" },
      { fixtureId: "complex-dashboard", baseline: null, current: 100, delta: null, indicator: "neutral" }
    ],
    overallBaseline: 85,
    overallCurrent: 94,
    overallDelta: 9
  };
  const table = formatVisualBenchmarkTable(result);
  assert.ok(table.includes("View"), "Table should contain 'View' header.");
  assert.ok(table.includes("Baseline"), "Table should contain 'Baseline' header.");
  assert.ok(table.includes("Current"), "Table should contain 'Current' header.");
  assert.ok(table.includes("Delta"), "Table should contain 'Delta' header.");
  assert.ok(table.includes("Simple Form"), "Table should contain fixture display name.");
  assert.ok(table.includes("Complex Dashboard"), "Table should contain fixture display name.");
  assert.ok(table.includes("Overall Average"), "Table should contain overall row.");
  assert.ok(table.includes("88"), "Table should contain current score.");
  assert.ok(table.includes("85"), "Table should contain baseline score.");
  assert.ok(table.includes("\u2014"), "Table should contain em-dash for null baseline.");
});

test("loadVisualBenchmarkBaseline loads the committed baseline file", async () => {
  const baseline = await loadVisualBenchmarkBaseline();
  assert.ok(baseline !== null, "Expected baseline to exist.");
  assert.equal(baseline.version, 1);
  assert.equal(baseline.scores.length, 5);
  for (const entry of baseline.scores) {
    assert.equal(entry.score, 100, `Expected baseline score of 100 for '${entry.fixtureId}'.`);
  }
});

test("saveVisualBenchmarkBaseline and loadVisualBenchmarkBaseline round-trip", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-benchmark-baseline-"));
  try {
    const result: VisualBenchmarkResult = {
      deltas: [
        { fixtureId: "test-fixture", baseline: null, current: 92, delta: null, indicator: "neutral" }
      ],
      overallBaseline: null,
      overallCurrent: 92,
      overallDelta: null
    };
    await saveVisualBenchmarkBaseline(result, { fixtureRoot });

    const loaded = await loadVisualBenchmarkBaseline({ fixtureRoot });
    assert.ok(loaded !== null);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.scores.length, 1);
    assert.equal(loaded.scores[0]?.fixtureId, "test-fixture");
    assert.equal(loaded.scores[0]?.score, 92);
    assert.ok(loaded.updatedAt.length > 0);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("loadVisualBenchmarkBaseline returns null when baseline file does not exist", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-visual-benchmark-nobaseline-"));
  try {
    const baseline = await loadVisualBenchmarkBaseline({ fixtureRoot });
    assert.equal(baseline, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("resolveVisualBenchmarkCliResolution accepts --update-baseline", () => {
  assert.deepEqual(resolveVisualBenchmarkCliResolution(["--update-baseline"]), {
    action: "maintenance",
    forwardedArgs: ["--update-baseline"]
  });
});

test("resolveVisualBenchmarkMaintenanceMode accepts --update-baseline", () => {
  assert.equal(resolveVisualBenchmarkMaintenanceMode(["--update-baseline"]), "update-baseline");
});
