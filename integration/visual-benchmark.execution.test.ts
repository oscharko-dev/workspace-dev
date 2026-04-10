import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { executeVisualBenchmarkFixture } from "./visual-benchmark.execution.js";
import { toScreenIdToken } from "./visual-benchmark.helpers.js";

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

let chromiumAvailabilityPromise:
  | Promise<{ available: true } | { available: false; reason: string }>
  | undefined;

const getChromiumAvailability = async (): Promise<
  { available: true } | { available: false; reason: string }
> => {
  chromiumAvailabilityPromise ??= (async () => {
    const executablePath = chromium.executablePath();
    try {
      await access(executablePath, fsConstants.X_OK);
      return { available: true } as const;
    } catch {
      return {
        available: false,
        reason: `Chromium executable is unavailable at '${executablePath}'.`,
      } as const;
    }
  })();

  return await chromiumAvailabilityPromise;
};

const skipIfChromiumUnavailable = async (context: TestContext): Promise<void> => {
  const availability = await getChromiumAvailability();
  if (!availability.available) {
    context.skip(availability.reason);
  }
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
          { width: 640, height: 480 },
          { width: 390, height: 844 },
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
