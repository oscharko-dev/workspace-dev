import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export class VisualDiffReferenceMissingError extends Error {
  readonly code = "E_VISUAL_DIFF_REFERENCE_MISSING" as const;
  constructor(filePath: string, cause?: unknown) {
    super(`Reference image not found at '${filePath}'`);
    this.name = "VisualDiffReferenceMissingError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export class VisualDiffTestMissingError extends Error {
  readonly code = "E_VISUAL_DIFF_TEST_MISSING" as const;
  constructor(filePath: string, cause?: unknown) {
    super(`Test image not found at '${filePath}'`);
    this.name = "VisualDiffTestMissingError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export class VisualDiffCorruptPngError extends Error {
  readonly code = "E_VISUAL_DIFF_CORRUPT_PNG" as const;
  constructor(which: "reference" | "test", cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : "unknown error";
    super(`Failed to decode ${which} PNG: ${detail}`);
    this.name = "VisualDiffCorruptPngError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export class VisualDiffDimensionMismatchError extends Error {
  readonly code = "E_VISUAL_DIFF_DIMENSION_MISMATCH" as const;
  constructor(
    referenceWidth: number,
    referenceHeight: number,
    testWidth: number,
    testHeight: number,
  ) {
    super(
      `Image dimensions do not match: reference is ${String(referenceWidth)}x${String(referenceHeight)}, test is ${String(testWidth)}x${String(testHeight)}`,
    );
    this.name = "VisualDiffDimensionMismatchError";
  }
}

export interface VisualDiffConfig {
  threshold: number;
  includeAntialiasing: boolean;
  alpha: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
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

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const assertFiniteNumber = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const resolveConfig = (
  partial?: Partial<VisualDiffConfig>,
): VisualDiffConfig => {
  if (!partial) {
    return { ...DEFAULT_DIFF_CONFIG };
  }

  const threshold = partial.threshold ?? DEFAULT_DIFF_CONFIG.threshold;
  const alpha = partial.alpha ?? DEFAULT_DIFF_CONFIG.alpha;

  assertFiniteNumber(threshold, "threshold");
  assertFiniteNumber(alpha, "alpha");

  if (threshold < 0 || threshold > 1) {
    throw new Error(
      `threshold must be between 0 and 1. Received ${String(threshold)}.`,
    );
  }
  if (alpha < 0 || alpha > 1) {
    throw new Error(
      `alpha must be between 0 and 1. Received ${String(alpha)}.`,
    );
  }
  if (partial.maxDiffPixels !== undefined) {
    assertFiniteNumber(partial.maxDiffPixels, "maxDiffPixels");
    if (partial.maxDiffPixels < 0) {
      throw new Error(
        `maxDiffPixels must be greater than or equal to 0. Received ${String(partial.maxDiffPixels)}.`,
      );
    }
  }
  if (partial.maxDiffPixelRatio !== undefined) {
    assertFiniteNumber(partial.maxDiffPixelRatio, "maxDiffPixelRatio");
    if (partial.maxDiffPixelRatio < 0 || partial.maxDiffPixelRatio > 1) {
      throw new Error(
        `maxDiffPixelRatio must be between 0 and 1. Received ${String(partial.maxDiffPixelRatio)}.`,
      );
    }
  }
  if (
    partial.includeAntialiasing !== undefined &&
    typeof partial.includeAntialiasing !== "boolean"
  ) {
    throw new Error("includeAntialiasing must be a boolean");
  }

  return {
    threshold,
    includeAntialiasing:
      partial.includeAntialiasing ?? DEFAULT_DIFF_CONFIG.includeAntialiasing,
    alpha,
    ...(partial.maxDiffPixels !== undefined
      ? { maxDiffPixels: partial.maxDiffPixels }
      : {}),
    ...(partial.maxDiffPixelRatio !== undefined
      ? { maxDiffPixelRatio: partial.maxDiffPixelRatio }
      : {}),
  };
};

const validateRegion = (
  region: VisualDiffRegionInput,
  imageWidth: number,
  imageHeight: number,
): VisualDiffRegionInput => {
  const values = [
    { name: `${region.name}.x`, value: region.x },
    { name: `${region.name}.y`, value: region.y },
    { name: `${region.name}.width`, value: region.width },
    { name: `${region.name}.height`, value: region.height },
  ];

  for (const entry of values) {
    assertFiniteNumber(entry.value, entry.name);
    if (!Number.isInteger(entry.value)) {
      throw new Error(`${entry.name} must be an integer`);
    }
  }

  if (region.width <= 0 || region.height <= 0) {
    throw new Error(
      `Region '${region.name}' must have positive width and height`,
    );
  }
  if (region.x < 0 || region.y < 0) {
    throw new Error(
      `Region '${region.name}' must start inside the image bounds`,
    );
  }
  if (
    region.x + region.width > imageWidth ||
    region.y + region.height > imageHeight
  ) {
    throw new Error(
      `Region '${region.name}' is out of bounds for image ${String(imageWidth)}x${String(imageHeight)}`,
    );
  }

  return region;
};

const buildDefaultRegions = (
  width: number,
  height: number,
): VisualDiffRegionInput[] => {
  const headerHeight = Math.max(1, Math.round(height * 0.2));
  const footerHeight = Math.max(1, Math.round(height * 0.2));
  const contentY = clamp(headerHeight, 0, Math.max(0, height - 1));
  const contentHeight = Math.max(1, height - headerHeight - footerHeight);
  const leftWidth = Math.max(1, Math.round(width / 3));
  const centerWidth = Math.max(1, Math.round(width / 3));
  const rightWidth = Math.max(1, width - leftWidth - centerWidth);
  const centerX = clamp(leftWidth, 0, Math.max(0, width - 1));
  const rightX = clamp(leftWidth + centerWidth, 0, Math.max(0, width - 1));

  return [
    { name: "header", x: 0, y: 0, width, height: headerHeight },
    {
      name: "content-left",
      x: 0,
      y: contentY,
      width: leftWidth,
      height: contentHeight,
    },
    {
      name: "content-center",
      x: centerX,
      y: contentY,
      width: centerWidth,
      height: contentHeight,
    },
    {
      name: "content-right",
      x: rightX,
      y: contentY,
      width: rightWidth,
      height: contentHeight,
    },
    {
      name: "footer",
      x: 0,
      y: height - footerHeight,
      width,
      height: footerHeight,
    },
  ];
};

const computeRegion = (
  referencePng: PNG,
  testPng: PNG,
  region: VisualDiffRegionInput,
  config: VisualDiffConfig,
): VisualDiffRegionResult => {
  const validatedRegion = validateRegion(
    region,
    referencePng.width,
    referencePng.height,
  );
  const refRegion = new PNG({
    width: validatedRegion.width,
    height: validatedRegion.height,
  });
  const testRegion = new PNG({
    width: validatedRegion.width,
    height: validatedRegion.height,
  });

  PNG.bitblt(
    referencePng,
    refRegion,
    validatedRegion.x,
    validatedRegion.y,
    validatedRegion.width,
    validatedRegion.height,
    0,
    0,
  );
  PNG.bitblt(
    testPng,
    testRegion,
    validatedRegion.x,
    validatedRegion.y,
    validatedRegion.width,
    validatedRegion.height,
    0,
    0,
  );

  const regionDiff = new PNG({
    width: validatedRegion.width,
    height: validatedRegion.height,
  });
  const regionDiffCount = pixelmatch(
    new Uint8Array(
      refRegion.data.buffer,
      refRegion.data.byteOffset,
      refRegion.data.byteLength,
    ),
    new Uint8Array(
      testRegion.data.buffer,
      testRegion.data.byteOffset,
      testRegion.data.byteLength,
    ),
    new Uint8Array(
      regionDiff.data.buffer,
      regionDiff.data.byteOffset,
      regionDiff.data.byteLength,
    ),
    validatedRegion.width,
    validatedRegion.height,
    {
      threshold: config.threshold,
      includeAA: config.includeAntialiasing,
      alpha: config.alpha,
    },
  );

  const totalPixels = validatedRegion.width * validatedRegion.height;
  const deviationPercent =
    Math.round((regionDiffCount / totalPixels) * 10000) / 100;

  return {
    name: validatedRegion.name,
    x: validatedRegion.x,
    y: validatedRegion.y,
    width: validatedRegion.width,
    height: validatedRegion.height,
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
  let referencePng: PNG;
  try {
    referencePng = PNG.sync.read(input.referenceBuffer);
  } catch (error: unknown) {
    throw new VisualDiffCorruptPngError("reference", error);
  }

  let testPng: PNG;
  try {
    testPng = PNG.sync.read(input.testBuffer);
  } catch (error: unknown) {
    throw new VisualDiffCorruptPngError("test", error);
  }

  if (
    referencePng.width !== testPng.width ||
    referencePng.height !== testPng.height
  ) {
    throw new VisualDiffDimensionMismatchError(
      referencePng.width,
      referencePng.height,
      testPng.width,
      testPng.height,
    );
  }

  const { width, height } = referencePng;
  const config = resolveConfig(input.config);
  const regions = input.regions ?? buildDefaultRegions(width, height);

  const diffPng = new PNG({ width, height });
  const diffPixelCount = pixelmatch(
    new Uint8Array(
      referencePng.data.buffer,
      referencePng.data.byteOffset,
      referencePng.data.byteLength,
    ),
    new Uint8Array(
      testPng.data.buffer,
      testPng.data.byteOffset,
      testPng.data.byteLength,
    ),
    new Uint8Array(
      diffPng.data.buffer,
      diffPng.data.byteOffset,
      diffPng.data.byteLength,
    ),
    width,
    height,
    {
      threshold: config.threshold,
      includeAA: config.includeAntialiasing,
      alpha: config.alpha,
    },
  );

  const totalPixels = width * height;
  let effectiveDiffPixelCount = diffPixelCount;
  if (config.maxDiffPixels !== undefined) {
    effectiveDiffPixelCount = Math.max(
      0,
      effectiveDiffPixelCount - Math.round(config.maxDiffPixels),
    );
  }
  if (config.maxDiffPixelRatio !== undefined) {
    effectiveDiffPixelCount = Math.max(
      0,
      effectiveDiffPixelCount -
        Math.round(totalPixels * config.maxDiffPixelRatio),
    );
  }
  const similarityScore =
    Math.round((1 - effectiveDiffPixelCount / totalPixels) * 10000) / 100;

  const regionResults = regions.map((region) =>
    computeRegion(referencePng, testPng, region, config),
  );

  const diffImageBuffer = PNG.sync.write(diffPng);

  return {
    diffImageBuffer,
    similarityScore,
    diffPixelCount,
    totalPixels,
    regions: regionResults,
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
  const readOrThrow = async (
    filePath: string,
    which: "reference" | "test",
  ): Promise<Buffer> => {
    try {
      return await readFile(filePath);
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "ENOENT") {
        throw which === "reference"
          ? new VisualDiffReferenceMissingError(filePath, error)
          : new VisualDiffTestMissingError(filePath, error);
      }
      throw error;
    }
  };

  const [referenceBuffer, testBuffer] = await Promise.all([
    readOrThrow(input.referencePath, "reference"),
    readOrThrow(input.testPath, "test"),
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
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, input.diffImageBuffer);
};
