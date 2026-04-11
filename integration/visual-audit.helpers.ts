import { PNG } from "pngjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { comparePngBuffers } from "../src/job-engine/visual-diff.js";
import {
  resolveVisualBenchmarkScreenPaths,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
} from "./visual-benchmark.helpers.js";
import { loadVisualBenchmarkLastRunArtifact } from "./visual-benchmark-runner.js";

const DIMENSION_MISMATCH_SIGNAL = "Image dimensions do not match";

export interface PngDimensions {
  width: number;
  height: number;
}

export class VisualAuditSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualAuditSurfaceError";
  }
}

export interface VisualAuditLastRunSurface {
  buffer: Buffer;
  ranAt: string;
}

export const buildLiveImageCacheKey = (
  metadata: VisualBenchmarkFixtureMetadata,
): string =>
  `${metadata.source.fileKey}:${metadata.source.nodeId}:${metadata.export.format}:${String(metadata.export.scale)}`;

export const readPngDimensions = (buffer: Buffer): PngDimensions => {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
  };
};

export const buildScreenMetadata = (
  parent: VisualBenchmarkFixtureMetadata,
  screen: VisualBenchmarkFixtureScreenMetadata,
): VisualBenchmarkFixtureMetadata => ({
  ...parent,
  source: {
    ...parent.source,
    nodeId: screen.nodeId,
    nodeName: screen.screenName,
  },
  viewport: {
    width: screen.viewport.width,
    height: screen.viewport.height,
  },
});

export const loadValidPngIfPresent = async (
  filePath: string,
): Promise<Buffer | null> => {
  try {
    return await readFile(filePath);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
};

export const loadFrozenScreenBuffer = async (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  fallback: Buffer,
  options: VisualBenchmarkFixtureOptions,
): Promise<Buffer> => {
  const paths = resolveVisualBenchmarkScreenPaths(
    fixtureId,
    screen.screenId,
    options,
  );
  const perScreen = await loadValidPngIfPresent(paths.referencePngPath);
  return perScreen ?? fallback;
};

export const safeSimilarityScore = (
  referenceBuffer: Buffer,
  testBuffer: Buffer,
): number => {
  try {
    const result = comparePngBuffers({ referenceBuffer, testBuffer });
    return result.similarityScore;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.includes(DIMENSION_MISMATCH_SIGNAL)
    ) {
      throw new VisualAuditSurfaceError(error.message);
    }
    throw error;
  }
};

export const loadLastRunSurfaceForScreen = async (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  options: VisualBenchmarkFixtureOptions,
): Promise<VisualAuditLastRunSurface | null> => {
  const entry =
    (await loadVisualBenchmarkLastRunArtifact(
      fixtureId,
      screen.screenId,
      options,
    )) ?? (await loadVisualBenchmarkLastRunArtifact(fixtureId, options));
  if (entry === null) {
    return null;
  }
  const absolutePath = path.resolve(process.cwd(), entry.actualImagePath);
  const buffer = await loadValidPngIfPresent(absolutePath);
  if (buffer === null) {
    return null;
  }
  return {
    buffer,
    ranAt: entry.ranAt,
  };
};
