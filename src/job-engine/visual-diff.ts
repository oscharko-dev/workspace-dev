import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface VisualDiffConfig {
  threshold: number;
  includeAntialiasing: boolean;
  alpha: number;
}

export interface VisualDiffRegionInput {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualDiffRegionResult {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  diffPixelCount: number;
  totalPixels: number;
  deviationPercent: number;
}

export interface VisualDiffResult {
  diffImageBuffer: Buffer;
  similarityScore: number;
  diffPixelCount: number;
  totalPixels: number;
  regions: VisualDiffRegionResult[];
  width: number;
  height: number;
}

export const DEFAULT_DIFF_CONFIG: VisualDiffConfig = {
  threshold: 0.1,
  includeAntialiasing: false,
  alpha: 0.1,
};

const resolveConfig = (partial?: Partial<VisualDiffConfig>): VisualDiffConfig => {
  if (!partial) {
    return { ...DEFAULT_DIFF_CONFIG };
  }
  return {
    threshold: partial.threshold ?? DEFAULT_DIFF_CONFIG.threshold,
    includeAntialiasing: partial.includeAntialiasing ?? DEFAULT_DIFF_CONFIG.includeAntialiasing,
    alpha: partial.alpha ?? DEFAULT_DIFF_CONFIG.alpha,
  };
};

const computeRegion = (
  referencePng: PNG,
  testPng: PNG,
  region: VisualDiffRegionInput,
  config: VisualDiffConfig,
): VisualDiffRegionResult => {
  const refRegion = new PNG({ width: region.width, height: region.height });
  const testRegion = new PNG({ width: region.width, height: region.height });

  PNG.bitblt(referencePng, refRegion, region.x, region.y, region.width, region.height, 0, 0);
  PNG.bitblt(testPng, testRegion, region.x, region.y, region.width, region.height, 0, 0);

  const regionDiff = new PNG({ width: region.width, height: region.height });
  const regionDiffCount = pixelmatch(
    new Uint8Array(refRegion.data.buffer, refRegion.data.byteOffset, refRegion.data.byteLength),
    new Uint8Array(testRegion.data.buffer, testRegion.data.byteOffset, testRegion.data.byteLength),
    new Uint8Array(regionDiff.data.buffer, regionDiff.data.byteOffset, regionDiff.data.byteLength),
    region.width,
    region.height,
    {
      threshold: config.threshold,
      includeAA: config.includeAntialiasing,
      alpha: config.alpha,
    },
  );

  const totalPixels = region.width * region.height;
  const deviationPercent = Math.round((regionDiffCount / totalPixels) * 10000) / 100;

  return {
    name: region.name,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    diffPixelCount: regionDiffCount,
    totalPixels,
    deviationPercent,
  };
};

export const comparePngBuffers = (input: {
  referenceBuffer: Buffer;
  testBuffer: Buffer;
  config?: Partial<VisualDiffConfig>;
  regions?: VisualDiffRegionInput[];
}): VisualDiffResult => {
  const referencePng = PNG.sync.read(input.referenceBuffer);
  const testPng = PNG.sync.read(input.testBuffer);

  if (referencePng.width !== testPng.width || referencePng.height !== testPng.height) {
    throw new Error(
      `Image dimensions do not match: reference is ${String(referencePng.width)}x${String(referencePng.height)}, test is ${String(testPng.width)}x${String(testPng.height)}`,
    );
  }

  const { width, height } = referencePng;
  const config = resolveConfig(input.config);

  const diffPng = new PNG({ width, height });
  const diffPixelCount = pixelmatch(
    new Uint8Array(referencePng.data.buffer, referencePng.data.byteOffset, referencePng.data.byteLength),
    new Uint8Array(testPng.data.buffer, testPng.data.byteOffset, testPng.data.byteLength),
    new Uint8Array(diffPng.data.buffer, diffPng.data.byteOffset, diffPng.data.byteLength),
    width,
    height,
    {
      threshold: config.threshold,
      includeAA: config.includeAntialiasing,
      alpha: config.alpha,
    },
  );

  const totalPixels = width * height;
  const similarityScore = Math.round((1 - diffPixelCount / totalPixels) * 10000) / 100;

  const regions: VisualDiffRegionResult[] = [];
  if (input.regions) {
    for (const region of input.regions) {
      regions.push(computeRegion(referencePng, testPng, region, config));
    }
  }

  const diffImageBuffer = PNG.sync.write(diffPng);

  return {
    diffImageBuffer,
    similarityScore,
    diffPixelCount,
    totalPixels,
    regions,
    width,
    height,
  };
};

export const comparePngFiles = async (input: {
  referencePath: string;
  testPath: string;
  config?: Partial<VisualDiffConfig>;
  regions?: VisualDiffRegionInput[];
}): Promise<VisualDiffResult> => {
  const [referenceBuffer, testBuffer] = await Promise.all([
    readFile(input.referencePath),
    readFile(input.testPath),
  ]);

  const args: {
    referenceBuffer: Buffer;
    testBuffer: Buffer;
    config?: Partial<VisualDiffConfig>;
    regions?: VisualDiffRegionInput[];
  } = { referenceBuffer, testBuffer };

  if (input.config !== undefined) {
    args.config = input.config;
  }
  if (input.regions !== undefined) {
    args.regions = input.regions;
  }

  return comparePngBuffers(args);
};

export const writeDiffImage = async (input: {
  diffImageBuffer: Buffer;
  outputPath: string;
}): Promise<void> => {
  await writeFile(input.outputPath, input.diffImageBuffer);
};
