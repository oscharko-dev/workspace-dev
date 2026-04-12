import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import { PNG } from "pngjs";
import { executeVisualBenchmarkFixture } from "./visual-benchmark.execution.js";
import {
  toScreenIdToken,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureMetadata,
} from "./visual-benchmark.helpers.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SIMPLE_FORM_FIXTURE_DIR = path.join(
  REPO_ROOT,
  "integration",
  "fixtures",
  "visual-benchmark",
  "simple-form",
);

type ExecutionTestViewport = {
  id: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  weight?: number;
};

type AvailableBenchmarkBrowserName = "chromium" | "firefox" | "webkit";

const PLAYWRIGHT_BROWSER_TYPES = {
  chromium,
  firefox,
  webkit,
} as const;

const getBrowserAvailability = async (
  browserName: AvailableBenchmarkBrowserName,
): Promise<
  { available: true } | { available: false; reason: string }
> => {
  const cacheKey = `${browserName}` as const;
  const browserType = PLAYWRIGHT_BROWSER_TYPES[cacheKey];
  const executablePath = browserType.executablePath();
  try {
    await access(executablePath, fsConstants.X_OK);
    return { available: true } as const;
  } catch {
    return {
      available: false,
      reason: `${browserName} executable is unavailable at '${executablePath}'.`,
    } as const;
  }
};

const skipIfBrowsersUnavailable = async (
  context: TestContext,
  browsers: readonly AvailableBenchmarkBrowserName[],
): Promise<boolean> => {
  for (const browser of browsers) {
    const availability = await getBrowserAvailability(browser);
    if (!availability.available) {
      context.skip(availability.reason);
      return true;
    }
  }
  return false;
};

const skipIfChromiumUnavailable = async (context: TestContext): Promise<void> => {
  await skipIfBrowsersUnavailable(context, ["chromium"]);
};

const createSolidPngBuffer = ({
  width,
  height,
}: {
  width: number;
  height: number;
}): Buffer => {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = 255;
    png.data[offset + 1] = 255;
    png.data[offset + 2] = 255;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
};

const createFixtureUnderTest = async ({
  fixtureRoot,
  fixtureId,
  viewports,
}: {
  fixtureRoot: string;
  fixtureId: string;
  viewports: readonly ExecutionTestViewport[];
}): Promise<void> => {
  const fixtureDir = path.join(fixtureRoot, fixtureId);
  await mkdir(fixtureDir, { recursive: true });
  await cp(
    path.join(SIMPLE_FORM_FIXTURE_DIR, "figma.json"),
    path.join(fixtureDir, "figma.json"),
  );
  await cp(
    path.join(SIMPLE_FORM_FIXTURE_DIR, "manifest.json"),
    path.join(fixtureDir, "manifest.json"),
  );

  const sourceMetadata = JSON.parse(
    await readFile(path.join(SIMPLE_FORM_FIXTURE_DIR, "metadata.json"), "utf8"),
  ) as {
    capturedAt: string;
    export: { format: string; scale: number };
    source: {
      fileKey: string;
      lastModified: string;
      nodeId: string;
      nodeName: string;
    };
  };

  const metadata = {
    capturedAt: sourceMetadata.capturedAt,
    export: sourceMetadata.export,
    fixtureId,
    source: sourceMetadata.source,
    version: 1,
    viewport: {
      width: 1280,
      height: 800,
    },
  };
  await writeFile(
    path.join(fixtureDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );

  const screenToken = toScreenIdToken(sourceMetadata.source.nodeId);
  const screenDir = path.join(fixtureDir, "screens", screenToken);
  await mkdir(screenDir, { recursive: true });
  await Promise.all(
    viewports.map(async (viewport) => {
      const pixelWidth = Math.round(
        viewport.width * (viewport.deviceScaleFactor ?? 1),
      );
      const pixelHeight = Math.round(
        viewport.height * (viewport.deviceScaleFactor ?? 1),
      );
      await writeFile(
        path.join(screenDir, `${viewport.id}.png`),
        createSolidPngBuffer({
          width: pixelWidth,
          height: pixelHeight,
        }),
      );
    }),
  );
};

const createStorybookStaticDir = async ({
  rootDir,
}: {
  rootDir: string;
}): Promise<string> => {
  const storybookStaticDir = path.join(rootDir, "storybook-static", "storybook-static");
  await mkdir(storybookStaticDir, { recursive: true });
  await writeFile(
    path.join(storybookStaticDir, "index.html"),
    "<!doctype html><html><body>Storybook</body></html>",
    "utf8",
  );
  await writeFile(
    path.join(storybookStaticDir, "iframe.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta charset=\"utf-8\" />",
      "    <style>",
      "      html, body { margin: 0; padding: 0; background: #ffffff; }",
      "      #storybook-root { position: relative; width: 200px; height: 160px; background: #ffffff; }",
      "      #component-box { width: 88px; height: 64px; margin-left: 16px; margin-top: 16px; background: rgb(32, 92, 196); border-radius: 8px; }",
      "    </style>",
      "  </head>",
      "  <body>",
      "    <div id=\"storybook-root\">",
      "      <div id=\"component-box\"></div>",
      "    </div>",
      "  </body>",
      "</html>",
    ].join("\n"),
    "utf8",
  );
  return storybookStaticDir;
};

const createStorybookReferenceBuffer = (): Buffer => {
  const png = new PNG({ width: 120, height: 96 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (png.width * y + x) << 2;
      const insideComponent = x >= 16 && x < 104 && y >= 16 && y < 80;
      png.data[offset] = insideComponent ? 32 : 255;
      png.data[offset + 1] = insideComponent ? 92 : 255;
      png.data[offset + 2] = insideComponent ? 196 : 255;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

const createStorybookComponentFixture = async ({
  fixtureRoot,
  fixtureId,
}: {
  fixtureRoot: string;
  fixtureId: string;
}): Promise<void> => {
  const manifest: VisualBenchmarkFixtureManifest = {
    version: 1,
    fixtureId,
    visualQuality: {
      frozenReferenceImage: "reference.png",
      frozenReferenceMetadata: "metadata.json",
    },
  };
  const metadata: VisualBenchmarkFixtureMetadata = {
    version: 4,
    mode: "storybook_component",
    fixtureId,
    capturedAt: "2026-04-09T00:00:00.000Z",
    source: {
      fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
      nodeId: "12:34",
      nodeName: "Storybook Components",
      lastModified: "2026-03-30T20:59:16Z",
    },
    viewport: {
      width: 200,
      height: 160,
    },
    export: {
      format: "png",
      scale: 1,
    },
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
        viewports: [{ id: "desktop", width: 200, height: 160 }],
      },
    ],
  };
  await mkdir(path.join(fixtureRoot, fixtureId), { recursive: true });
  await writeVisualBenchmarkFixtureManifest(fixtureId, manifest, { fixtureRoot });
  await writeVisualBenchmarkFixtureMetadata(fixtureId, metadata, { fixtureRoot });
  await writeVisualBenchmarkFixtureInputs(
    fixtureId,
    { document: { id: "fixture", type: "DOCUMENT", children: [] } },
    { fixtureRoot },
  );
  await mkdir(
    path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      toScreenIdToken("button-primary"),
    ),
    { recursive: true },
  );
  await writeFile(
    path.join(
      fixtureRoot,
      fixtureId,
      "screens",
      toScreenIdToken("button-primary"),
      "desktop.png",
    ),
    createStorybookReferenceBuffer(),
  );
};

test(
  "executeVisualBenchmarkFixture fans out configured viewports and aggregates their scores",
  { timeout: 300_000 },
  async (context) => {
    await skipIfChromiumUnavailable(context);
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-dev-visual-benchmark-execution-"),
    );
    const fixtureId = "issue-838-viewport-fanout";
    const viewports: readonly ExecutionTestViewport[] = [
      {
        id: "desktop",
        width: 640,
        height: 480,
        deviceScaleFactor: 1,
        weight: 1,
      },
      {
        id: "mobile",
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        weight: 3,
      },
    ];

    try {
      await createFixtureUnderTest({
        fixtureRoot,
        fixtureId,
        viewports,
      });

      const result = await executeVisualBenchmarkFixture(fixtureId, {
        fixtureRoot,
        workspaceRoot: REPO_ROOT,
        qualityConfig: {
          viewports,
        },
      });

      assert.equal(result.fixtureId, fixtureId);
      assert.equal(result.screens.length, 1);
      assert.equal(result.screens[0]?.viewports?.length, 2);
      assert.deepEqual(
        result.screens[0]?.viewports?.map((viewport) => viewport.viewportId),
        ["desktop", "mobile"],
      );
      assert.deepEqual(
        result.screens[0]?.viewports?.map((viewport) => viewport.viewport),
        [
          { width: 640, height: 480, deviceScaleFactor: 1 },
          { width: 390, height: 844, deviceScaleFactor: 3 },
        ],
      );

      const viewportArtifacts = result.screens[0]?.viewports ?? [];
      const expectedScore = Math.round(
        ((viewportArtifacts[0]!.score * 1 + viewportArtifacts[1]!.score * 3) / 4) * 100,
      ) / 100;
      assert.equal(result.screens[0]?.score, expectedScore);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "executeVisualBenchmarkFixture filters to the selected viewport and rejects unknown viewport ids clearly",
  { timeout: 180_000 },
  async (context) => {
    await skipIfChromiumUnavailable(context);
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-dev-visual-benchmark-execution-"),
    );
    const fixtureId = "issue-838-viewport-filter";
    const viewports: readonly ExecutionTestViewport[] = [
      {
        id: "desktop",
        width: 640,
        height: 480,
        deviceScaleFactor: 1,
      },
      {
        id: "mobile",
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
      },
    ];

    try {
      await createFixtureUnderTest({
        fixtureRoot,
        fixtureId,
        viewports,
      });

      const filteredResult = await executeVisualBenchmarkFixture(fixtureId, {
        fixtureRoot,
        workspaceRoot: REPO_ROOT,
        viewportId: "mobile",
        qualityConfig: {
          viewports,
        },
      });
      assert.equal(filteredResult.screens[0]?.viewports?.length, 1);
      assert.equal(filteredResult.screens[0]?.viewports?.[0]?.viewportId, "mobile");

      await assert.rejects(
        () =>
          executeVisualBenchmarkFixture(fixtureId, {
            fixtureRoot,
            workspaceRoot: REPO_ROOT,
            viewportId: "tablet",
            qualityConfig: {
              viewports,
            },
          }),
        /does not define viewport 'tablet'. Available viewports: desktop, mobile\./i,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "executeVisualBenchmarkFixture captures storybook_component screens and normalizes them to the baseline canvas",
  { timeout: 180_000 },
  async (context) => {
    await skipIfChromiumUnavailable(context);
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-dev-storybook-component-execution-"),
    );
    const fixtureRoot = path.join(tempRoot, "fixtures");
    const fixtureId = "storybook-components";

    try {
      await createStorybookStaticDir({ rootDir: tempRoot });
      await createStorybookComponentFixture({ fixtureRoot, fixtureId });

      const result = await executeVisualBenchmarkFixture(fixtureId, {
        fixtureRoot,
        workspaceRoot: tempRoot,
        storybookStaticDir: path.join("storybook-static", "storybook-static"),
      });

      assert.equal(result.fixtureId, fixtureId);
      assert.equal(result.componentAggregateScore, result.aggregateScore);
      assert.equal(result.componentCoverage?.comparedCount, 1);
      assert.equal(result.componentCoverage?.skippedCount, 0);
      assert.equal(result.screens.length, 1);
      assert.equal(result.screens[0]?.status, "completed");
      assert.equal(result.screens[0]?.viewports?.[0]?.viewport.width, 120);
      assert.equal(result.screens[0]?.viewports?.[0]?.viewport.height, 96);
      assert.ok((result.screens[0]?.score ?? 0) >= 99);
      assert.ok(
        result.screens[0]?.diffBuffer !== null,
        "expected a diff buffer to be produced",
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);

test(
  "executeVisualBenchmarkFixture captures generated_app_screen fixtures across the requested browsers",
  { timeout: 300_000 },
  async () => {
    const requestedBrowsers: readonly AvailableBenchmarkBrowserName[] = [
      "chromium",
      "firefox",
      "webkit",
    ];
    const availabilityChecks = await Promise.all(
      requestedBrowsers.map(async (browser) => ({
        browser,
        availability: await getBrowserAvailability(browser),
      })),
    );
    const availableBrowsers = availabilityChecks
      .filter((entry): entry is { browser: AvailableBenchmarkBrowserName; availability: { available: true } } => {
        return entry.availability.available;
      })
      .map((entry) => entry.browser);

    assert.ok(
      availableBrowsers.includes("chromium"),
      "chromium must be available for cross-browser visual benchmark execution tests.",
    );

    const expectedPairwiseDiffCount = Math.max(
      0,
      (availableBrowsers.length * (availableBrowsers.length - 1)) / 2,
    );

    if (availableBrowsers.length < requestedBrowsers.length) {
      const missingBrowsers = availabilityChecks
        .filter((entry) => !entry.availability.available)
        .map((entry) => `${entry.browser}: ${entry.availability.reason}`)
        .join("; ");
      process.stderr.write(
        `WARN visual-benchmark.execution.test: running browser fan-out assertions with available browsers (${availableBrowsers.join(", ")}); missing: ${missingBrowsers}\n`,
      );
    }
    const fixtureRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-dev-visual-benchmark-execution-browsers-"),
    );
    const fixtureId = "issue-848-browser-fanout";
    const viewports: readonly ExecutionTestViewport[] = [
      {
        id: "desktop",
        width: 640,
        height: 480,
        deviceScaleFactor: 1,
        weight: 1,
      },
    ];

    try {
      await createFixtureUnderTest({
        fixtureRoot,
        fixtureId,
        viewports,
      });

      const result = await executeVisualBenchmarkFixture(fixtureId, {
        fixtureRoot,
        workspaceRoot: REPO_ROOT,
        qualityConfig: {
          viewports,
        },
        browsers: availableBrowsers,
      });

      assert.equal(result.screens.length, 1);
      assert.deepEqual(
        Object.keys(result.browserBreakdown ?? {}).sort(),
        [...availableBrowsers].sort(),
      );
      assert.deepEqual(
        result.screens[0]?.browserArtifacts?.map((artifact) => artifact.browser),
        availableBrowsers,
      );
      const screenPairwiseDiffCount =
        result.screens[0]?.crossBrowserConsistency?.pairwiseDiffs.length ?? 0;
      const overallPairwiseDiffCount =
        result.crossBrowserConsistency?.pairwiseDiffs.length ?? 0;
      assert.equal(
        screenPairwiseDiffCount,
        expectedPairwiseDiffCount,
      );
      assert.equal(
        overallPairwiseDiffCount,
        expectedPairwiseDiffCount,
      );
      assert.deepEqual(
        result.crossBrowserConsistency?.browsers ?? availableBrowsers,
        availableBrowsers,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "executeVisualBenchmarkFixture skips incomplete storybook_component mappings without failing the run",
  async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "workspace-dev-storybook-component-skip-"),
    );
    const fixtureRoot = path.join(tempRoot, "fixtures");
    const fixtureId = "storybook-components-skip";

    try {
      await createStorybookComponentFixture({ fixtureRoot, fixtureId });
      const metadata: VisualBenchmarkFixtureMetadata = {
        version: 4,
        mode: "storybook_component",
        fixtureId,
        capturedAt: "2026-04-09T00:00:00.000Z",
        source: {
          fileKey: "DUArQ8VuM3aPMjXFLaQSSH",
          nodeId: "12:34",
          nodeName: "Storybook Components",
          lastModified: "2026-03-30T20:59:16Z",
        },
        viewport: {
          width: 200,
          height: 160,
        },
        export: {
          format: "png",
          scale: 1,
        },
        screens: [
          {
            screenId: "button-primary",
            screenName: "Button",
            nodeId: "12:34",
            viewport: { width: 200, height: 160 },
            referenceNodeId: "12:34",
            referenceFileKey: "DUArQ8VuM3aPMjXFLaQSSH",
            captureStrategy: "storybook_root_union",
            baselineCanvas: { width: 120, height: 96 },
            viewports: [{ id: "desktop", width: 200, height: 160 }],
          },
        ],
      };
      await writeVisualBenchmarkFixtureMetadata(fixtureId, metadata, {
        fixtureRoot,
      });

      const result = await executeVisualBenchmarkFixture(fixtureId, {
        fixtureRoot,
        workspaceRoot: tempRoot,
      });

      assert.equal(result.aggregateScore, 0);
      assert.equal(result.componentCoverage?.comparedCount, 0);
      assert.equal(result.componentCoverage?.skippedCount, 1);
      assert.equal(result.componentCoverage?.bySkipReason.incomplete_mapping, 1);
      assert.equal(result.screens[0]?.status, "skipped");
      assert.match(result.warnings?.[0] ?? "", /missing required metadata/i);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// computeCrossBrowserConsistencyScore — Issue #848
// ---------------------------------------------------------------------------

import {
  computeCrossBrowserConsistencyScore,
  isVisualBrowserName as isBenchmarkBrowserName,
  assertVisualBrowserName as assertBenchmarkBrowserName,
  VISUAL_BROWSER_NAMES as BENCHMARK_BROWSER_NAMES,
} from "../src/job-engine/visual-browser-matrix.js";

const makeSolidPngBuffer = ({
  width,
  height,
  r,
  g,
  b,
}: {
  width: number;
  height: number;
  r: number;
  g: number;
  b: number;
}): Buffer => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4 + 0] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
};

const makeSparsePixelPngBuffer = ({
  width,
  height,
  activePixelIndexes,
}: {
  width: number;
  height: number;
  activePixelIndexes: readonly number[];
}): Buffer => {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    const index = i * 4;
    const isActive = activePixelIndexes.includes(i);
    const channel = isActive ? 0 : 255;
    png.data[index + 0] = channel;
    png.data[index + 1] = channel;
    png.data[index + 2] = channel;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
};

test("computeCrossBrowserConsistencyScore returns score 100 for a single browser", () => {
  const buffer = makeSolidPngBuffer({ width: 10, height: 10, r: 255, g: 0, b: 0 });
  const result = computeCrossBrowserConsistencyScore([
    { browser: "chromium", screenshotBuffer: buffer },
  ]);
  assert.equal(result.consistencyScore, 100);
  assert.deepEqual(result.pairwiseDiffs, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.browsers, ["chromium"]);
});

test("computeCrossBrowserConsistencyScore returns score 100 for identical screenshots", () => {
  const buffer = makeSolidPngBuffer({ width: 10, height: 10, r: 0, g: 128, b: 255 });
  const result = computeCrossBrowserConsistencyScore([
    { browser: "chromium", screenshotBuffer: buffer },
    { browser: "firefox", screenshotBuffer: buffer },
  ]);
  assert.equal(result.consistencyScore, 100);
  assert.equal(result.pairwiseDiffs.length, 1);
  assert.equal(result.pairwiseDiffs[0]?.diffPercent, 0);
  assert.deepEqual(result.warnings, []);
});

test("computeCrossBrowserConsistencyScore detects differences between browsers", () => {
  const redBuffer = makeSolidPngBuffer({ width: 10, height: 10, r: 255, g: 0, b: 0 });
  const blueBuffer = makeSolidPngBuffer({ width: 10, height: 10, r: 0, g: 0, b: 255 });
  const result = computeCrossBrowserConsistencyScore([
    { browser: "chromium", screenshotBuffer: redBuffer },
    { browser: "firefox", screenshotBuffer: blueBuffer },
  ]);
  assert.ok(result.consistencyScore < 100);
  assert.equal(result.pairwiseDiffs.length, 1);
  assert.ok((result.pairwiseDiffs[0]?.diffPercent ?? 0) > 0);
  assert.ok(result.warnings.length > 0);
  assert.match(
    result.warnings[0] ?? "",
    /chromium\s+vs\s+firefox: rendering differs by 100%/i,
  );
});

test("computeCrossBrowserConsistencyScore produces pairwise diffs for three browsers", () => {
  const bufA = makeSolidPngBuffer({ width: 4, height: 4, r: 255, g: 0, b: 0 });
  const bufB = makeSolidPngBuffer({ width: 4, height: 4, r: 0, g: 255, b: 0 });
  const bufC = makeSolidPngBuffer({ width: 4, height: 4, r: 0, g: 0, b: 255 });
  const result = computeCrossBrowserConsistencyScore([
    { browser: "chromium", screenshotBuffer: bufA },
    { browser: "firefox", screenshotBuffer: bufB },
    { browser: "webkit", screenshotBuffer: bufC },
  ]);
  // 3 browsers → 3 pairwise combinations
  assert.equal(result.pairwiseDiffs.length, 3);
  assert.deepEqual(result.browsers, ["chromium", "firefox", "webkit"]);
});

test("computeCrossBrowserConsistencyScore warns when the worst pair does not include the first browser", () => {
  const chromiumBuffer = makeSparsePixelPngBuffer({
    width: 10,
    height: 10,
    activePixelIndexes: [],
  });
  const firefoxBuffer = makeSparsePixelPngBuffer({
    width: 10,
    height: 10,
    activePixelIndexes: [0, 1, 2, 3],
  });
  const webkitBuffer = makeSparsePixelPngBuffer({
    width: 10,
    height: 10,
    activePixelIndexes: [4, 5, 6, 7],
  });

  const result = computeCrossBrowserConsistencyScore([
    { browser: "chromium", screenshotBuffer: chromiumBuffer },
    { browser: "firefox", screenshotBuffer: firefoxBuffer },
    { browser: "webkit", screenshotBuffer: webkitBuffer },
  ]);

  assert.equal(result.consistencyScore, 92);
  assert.equal(result.pairwiseDiffs.length, 3);
  assert.equal(
    result.pairwiseDiffs.find(
      (pair) => pair.browserA === "firefox" && pair.browserB === "webkit",
    )?.diffPercent,
    8,
  );
  assert.ok(
    result.warnings.some((warning) =>
      /firefox\s+vs\s+webkit: rendering differs by 8%/i.test(warning),
    ),
  );
});

test("computeCrossBrowserConsistencyScore throws for empty entry list", () => {
  assert.throws(
    () => computeCrossBrowserConsistencyScore([]),
    /at least one browser/i,
  );
});

test("isBenchmarkBrowserName returns true for known browsers", () => {
  for (const name of BENCHMARK_BROWSER_NAMES) {
    assert.ok(isBenchmarkBrowserName(name), `Expected ${name} to be valid`);
  }
});

test("isBenchmarkBrowserName returns false for unknown values", () => {
  assert.equal(isBenchmarkBrowserName("opera"), false);
  assert.equal(isBenchmarkBrowserName(42), false);
  assert.equal(isBenchmarkBrowserName(null), false);
});

test("assertBenchmarkBrowserName throws for unknown browser", () => {
  assert.throws(
    () => assertBenchmarkBrowserName("safari"),
    /Unknown browser/i,
  );
});

test("assertBenchmarkBrowserName returns the browser name when valid", () => {
  assert.equal(assertBenchmarkBrowserName("firefox"), "firefox");
});
