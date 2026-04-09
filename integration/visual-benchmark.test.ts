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
