import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
} from "./visual-benchmark.helpers.js";
import { runVisualBenchmark } from "./visual-benchmark-runner.js";

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

const baseMetadata: VisualBenchmarkFixtureMetadata = {
  version: 1,
  fixtureId: "fixture-base",
  capturedAt: "2026-04-09T00:00:00.000Z",
  source: {
    fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
    nodeId: "1:65671",
    nodeName: "Base Fixture",
    lastModified: "2026-03-30T20:59:16Z",
  },
  viewport: { width: 800, height: 600 },
  export: { format: "png", scale: 1 },
};

const baseManifest: VisualBenchmarkFixtureManifest = {
  version: 1,
  fixtureId: "fixture-base",
  visualQuality: {
    frozenReferenceImage: "reference.png",
    frozenReferenceMetadata: "metadata.json",
  },
};

const writeFixture = async (
  fixtureRoot: string,
  artifactRoot: string,
  metadata: VisualBenchmarkFixtureMetadata,
): Promise<void> => {
  await mkdir(path.join(fixtureRoot, metadata.fixtureId), { recursive: true });
  await writeVisualBenchmarkFixtureManifest(
    metadata.fixtureId,
    { ...baseManifest, fixtureId: metadata.fixtureId },
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

const buildEnv = async (): Promise<{
  fixtureRoot: string;
  artifactRoot: string;
  cleanup: () => Promise<void>;
}> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-visual-benchmark-error-isolation-"),
  );
  const fixtureRoot = path.join(root, "fixtures");
  const artifactRoot = path.join(root, "artifacts");
  return {
    fixtureRoot,
    artifactRoot,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const successfulFixtureResult = (
  fixtureId: string,
  screenId: string,
  screenName: string,
  score: number,
) => ({
  fixtureId,
  aggregateScore: score,
  screens: [
    {
      screenId,
      screenName,
      nodeId: screenId,
      status: "completed" as const,
      score,
      screenshotBuffer: createTestPngBuffer(4, 4, [10, 20, 30, 255]),
      diffBuffer: createTestPngBuffer(4, 4, [0, 0, 0, 0]),
      report: null,
      viewport: { width: 800, height: 600 },
    },
  ],
});

test("runVisualBenchmark isolates a single fixture failure and continues with remaining fixtures", async () => {
  const env = await buildEnv();
  try {
    await writeFixture(env.fixtureRoot, env.artifactRoot, {
      ...baseMetadata,
      fixtureId: "good-fixture",
      source: {
        ...baseMetadata.source,
        nodeId: "1:1000",
        nodeName: "Good Fixture",
      },
    });
    await writeFixture(env.fixtureRoot, env.artifactRoot, {
      ...baseMetadata,
      fixtureId: "bad-fixture",
      source: {
        ...baseMetadata.source,
        nodeId: "1:2000",
        nodeName: "Bad Fixture",
      },
    });

    const result = await runVisualBenchmark(
      { fixtureRoot: env.fixtureRoot, artifactRoot: env.artifactRoot },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === "bad-fixture") {
            throw Object.assign(new Error("reference image is missing"), {
              code: "E_VISUAL_DIFF_REFERENCE_MISSING",
            });
          }
          return successfulFixtureResult(
            fixtureId,
            "1:1000",
            "Good Fixture",
            82,
          );
        },
      },
    );

    assert.ok(
      Array.isArray(result.failedFixtures),
      "Expected failedFixtures to be populated.",
    );
    assert.equal(result.failedFixtures?.length, 1);
    assert.equal(result.failedFixtures?.[0]?.fixtureId, "bad-fixture");
    assert.equal(
      result.failedFixtures?.[0]?.error.code,
      "E_VISUAL_DIFF_REFERENCE_MISSING",
    );
    assert.match(
      result.failedFixtures?.[0]?.error.message ?? "",
      /reference image is missing/,
    );
    const goodDeltas = result.deltas.filter(
      (delta) => delta.fixtureId === "good-fixture",
    );
    assert.ok(goodDeltas.length > 0, "Good fixture must produce a delta.");
    assert.equal(goodDeltas[0]?.current, 82);
    const badDeltas = result.deltas.filter(
      (delta) => delta.fixtureId === "bad-fixture",
    );
    assert.equal(badDeltas.length, 0);
  } finally {
    await env.cleanup();
  }
});

test("runVisualBenchmark falls back to a generic failure code when the thrown error has no code field", async () => {
  const env = await buildEnv();
  try {
    await writeFixture(env.fixtureRoot, env.artifactRoot, {
      ...baseMetadata,
      fixtureId: "only-fixture",
      source: {
        ...baseMetadata.source,
        nodeId: "1:3000",
        nodeName: "Only Fixture",
      },
    });

    const result = await runVisualBenchmark(
      { fixtureRoot: env.fixtureRoot, artifactRoot: env.artifactRoot },
      {
        executeFixture: async () => {
          throw new Error("browser crashed");
        },
      },
    );

    assert.equal(result.failedFixtures?.length, 1);
    assert.equal(result.failedFixtures?.[0]?.fixtureId, "only-fixture");
    assert.equal(
      result.failedFixtures?.[0]?.error.code,
      "E_VISUAL_BENCHMARK_FIXTURE_FAILED",
    );
    assert.equal(result.deltas.length, 0);
    assert.equal(result.overallCurrent, 0);
  } finally {
    await env.cleanup();
  }
});

test("runVisualBenchmark persists failedFixtures into last-run.json after a mixed run", async () => {
  const env = await buildEnv();
  try {
    await writeFixture(env.fixtureRoot, env.artifactRoot, {
      ...baseMetadata,
      fixtureId: "alpha-fixture",
      source: {
        ...baseMetadata.source,
        nodeId: "1:4000",
        nodeName: "Alpha Fixture",
      },
    });
    await writeFixture(env.fixtureRoot, env.artifactRoot, {
      ...baseMetadata,
      fixtureId: "beta-fixture",
      source: {
        ...baseMetadata.source,
        nodeId: "1:5000",
        nodeName: "Beta Fixture",
      },
    });

    await runVisualBenchmark(
      { fixtureRoot: env.fixtureRoot, artifactRoot: env.artifactRoot },
      {
        executeFixture: async (fixtureId) => {
          if (fixtureId === "beta-fixture") {
            throw Object.assign(new Error("corrupt PNG"), {
              code: "E_VISUAL_DIFF_CORRUPT_PNG",
            });
          }
          return successfulFixtureResult(
            fixtureId,
            "1:4000",
            "Alpha Fixture",
            77,
          );
        },
      },
    );

    const persisted = JSON.parse(
      await readFile(path.join(env.artifactRoot, "last-run.json"), "utf8"),
    ) as {
      failedFixtures?: Array<{
        fixtureId: string;
        error: { code: string; message: string };
      }>;
    };
    assert.ok(
      Array.isArray(persisted.failedFixtures),
      "Expected last-run.json to contain failedFixtures array.",
    );
    assert.equal(persisted.failedFixtures?.length, 1);
    assert.equal(persisted.failedFixtures?.[0]?.fixtureId, "beta-fixture");
    assert.equal(
      persisted.failedFixtures?.[0]?.error.code,
      "E_VISUAL_DIFF_CORRUPT_PNG",
    );
    assert.match(
      persisted.failedFixtures?.[0]?.error.message ?? "",
      /corrupt PNG/,
    );
  } finally {
    await env.cleanup();
  }
});
