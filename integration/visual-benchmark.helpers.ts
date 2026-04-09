import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(MODULE_DIR, "fixtures", "visual-benchmark");
const FIGMA_JSON_FILE_NAME = "figma.json";
const MANIFEST_JSON_FILE_NAME = "manifest.json";
const METADATA_JSON_FILE_NAME = "metadata.json";
const REFERENCE_PNG_FILE_NAME = "reference.png";

const FORBIDDEN_FIXTURE_PATH_SEGMENTS = [
  "storybook-static",
  ".zip",
  ".."
] as const;

const PNG_MAGIC_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

export interface VisualBenchmarkViewport {
  width: number;
  height: number;
}

export interface VisualBenchmarkExportConfig {
  format: "png";
  scale: number;
}

export interface VisualBenchmarkFixtureSource {
  fileKey: string;
  nodeId: string;
  nodeName: string;
  lastModified: string;
}

export interface VisualBenchmarkFixtureMetadata {
  version: 1;
  fixtureId: string;
  capturedAt: string;
  source: VisualBenchmarkFixtureSource;
  viewport: VisualBenchmarkViewport;
  export: VisualBenchmarkExportConfig;
}

export interface VisualBenchmarkFixtureBundle {
  manifest: VisualBenchmarkFixtureManifest;
  metadata: VisualBenchmarkFixtureMetadata;
  figmaInput: unknown;
  referenceBuffer: Buffer;
}

export interface VisualBenchmarkFixtureManifest {
  version: 1;
  fixtureId: string;
  visualQuality: {
    frozenReferenceImage: string;
    frozenReferenceMetadata: string;
  };
}

export interface VisualBenchmarkFixturePaths {
  fixtureDir: string;
  figmaJsonPath: string;
  manifestJsonPath: string;
  metadataJsonPath: string;
  referencePngPath: string;
}

export interface VisualBenchmarkFixtureOptions {
  fixtureRoot?: string;
  artifactRoot?: string;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  const sortedEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of sortedEntries) {
    output[key] = toStableJsonValue(entryValue);
  }
  return output;
};

const parseRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
};

const parsePositiveNumber = (value: unknown, fieldName: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return parsed;
};

const parseMetadata = (input: string): VisualBenchmarkFixtureMetadata => {
  const parsed = JSON.parse(input) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected visual-benchmark metadata to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("visual-benchmark metadata version must be 1.");
  }

  const source = parsed.source;
  if (!isPlainRecord(source)) {
    throw new Error("visual-benchmark metadata source section is required.");
  }

  const viewport = parsed.viewport;
  if (!isPlainRecord(viewport)) {
    throw new Error("visual-benchmark metadata viewport section is required.");
  }

  const exportConfig = parsed.export;
  if (!isPlainRecord(exportConfig)) {
    throw new Error("visual-benchmark metadata export section is required.");
  }

  const format = parseRequiredString(exportConfig.format, "visual-benchmark metadata export.format");
  if (format !== "png") {
    throw new Error("visual-benchmark metadata export.format must be 'png'.");
  }

  return {
    version: 1,
    fixtureId: parseRequiredString(parsed.fixtureId, "visual-benchmark metadata fixtureId"),
    capturedAt: parseRequiredString(parsed.capturedAt, "visual-benchmark metadata capturedAt"),
    source: {
      fileKey: parseRequiredString(source.fileKey, "visual-benchmark metadata source.fileKey"),
      nodeId: parseRequiredString(source.nodeId, "visual-benchmark metadata source.nodeId"),
      nodeName: parseRequiredString(source.nodeName, "visual-benchmark metadata source.nodeName"),
      lastModified: parseRequiredString(source.lastModified, "visual-benchmark metadata source.lastModified")
    },
    viewport: {
      width: parsePositiveNumber(viewport.width, "visual-benchmark metadata viewport.width"),
      height: parsePositiveNumber(viewport.height, "visual-benchmark metadata viewport.height")
    },
    export: {
      format: "png",
      scale: parsePositiveNumber(exportConfig.scale, "visual-benchmark metadata export.scale")
    }
  };
};

const parseManifest = (input: string): VisualBenchmarkFixtureManifest => {
  const parsed = JSON.parse(input) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected visual-benchmark manifest to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("visual-benchmark manifest version must be 1.");
  }
  const visualQuality = parsed.visualQuality;
  if (!isPlainRecord(visualQuality)) {
    throw new Error("visual-benchmark manifest visualQuality section is required.");
  }
  return {
    version: 1,
    fixtureId: parseRequiredString(parsed.fixtureId, "visual-benchmark manifest fixtureId"),
    visualQuality: {
      frozenReferenceImage: parseRequiredString(
        visualQuality.frozenReferenceImage,
        "visual-benchmark manifest visualQuality.frozenReferenceImage"
      ),
      frozenReferenceMetadata: parseRequiredString(
        visualQuality.frozenReferenceMetadata,
        "visual-benchmark manifest visualQuality.frozenReferenceMetadata"
      )
    }
  };
};

const resolveFixtureRoot = (options?: VisualBenchmarkFixtureOptions): string => {
  return options?.fixtureRoot ?? FIXTURE_ROOT;
};

export const toStableJsonString = (value: unknown): string => `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;

export const assertAllowedFixturePath = (value: string): string => {
  const normalized = value.replace(/\\/gu, "/").trim();
  if (normalized.length === 0) {
    throw new Error("Fixture path must not be empty.");
  }
  if (path.isAbsolute(normalized)) {
    throw new Error(`Fixture path '${normalized}' must be relative.`);
  }
  for (const forbiddenSegment of FORBIDDEN_FIXTURE_PATH_SEGMENTS) {
    if (normalized.includes(forbiddenSegment)) {
      throw new Error(`Fixture path '${normalized}' contains forbidden segment '${forbiddenSegment}'.`);
    }
  }
  return normalized;
};

export const assertAllowedFixtureId = (value: string): string => {
  const normalized = assertAllowedFixturePath(value);
  if (normalized.includes("/")) {
    throw new Error(`Fixture id '${normalized}' must not contain path separators.`);
  }
  return normalized;
};

export const isValidPngBuffer = (buffer: Buffer): boolean => {
  if (buffer.length < PNG_MAGIC_BYTES.length) {
    return false;
  }
  for (let index = 0; index < PNG_MAGIC_BYTES.length; index++) {
    if (buffer[index] !== PNG_MAGIC_BYTES[index]) {
      return false;
    }
  }
  return true;
};

export const getVisualBenchmarkFixtureRoot = (): string => FIXTURE_ROOT;

export const resolveVisualBenchmarkFixturePaths = (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): VisualBenchmarkFixturePaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const fixtureDir = path.join(resolveFixtureRoot(options), normalizedFixtureId);
  return {
    fixtureDir,
    figmaJsonPath: path.join(fixtureDir, FIGMA_JSON_FILE_NAME),
    manifestJsonPath: path.join(fixtureDir, MANIFEST_JSON_FILE_NAME),
    metadataJsonPath: path.join(fixtureDir, METADATA_JSON_FILE_NAME),
    referencePngPath: path.join(fixtureDir, REFERENCE_PNG_FILE_NAME)
  };
};

export const listVisualBenchmarkFixtureIds = async (options?: VisualBenchmarkFixtureOptions): Promise<string[]> => {
  const entries = await readdir(resolveFixtureRoot(options), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const loadVisualBenchmarkFixtureMetadata = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): Promise<VisualBenchmarkFixtureMetadata> => {
  const { metadataJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const content = await readFile(metadataJsonPath, "utf8");
  const metadata = parseMetadata(content);
  assert.equal(
    metadata.fixtureId,
    fixtureId,
    `Metadata fixtureId '${metadata.fixtureId}' does not match directory name '${fixtureId}'.`
  );
  return metadata;
};

export const loadVisualBenchmarkFixtureManifest = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): Promise<VisualBenchmarkFixtureManifest> => {
  const { manifestJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const content = await readFile(manifestJsonPath, "utf8");
  const manifest = parseManifest(content);
  assert.equal(
    manifest.fixtureId,
    fixtureId,
    `Manifest fixtureId '${manifest.fixtureId}' does not match directory name '${fixtureId}'.`
  );
  return manifest;
};

export const loadVisualBenchmarkFixtureInputs = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): Promise<unknown> => {
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const content = await readFile(figmaJsonPath, "utf8");
  return JSON.parse(content) as unknown;
};

export const loadVisualBenchmarkReference = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): Promise<Buffer> => {
  const { referencePngPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const buffer = await readFile(referencePngPath);
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Reference for fixture '${fixtureId}' is not a valid PNG.`);
  }
  return buffer;
};

export const loadVisualBenchmarkFixtureBundle = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions
): Promise<VisualBenchmarkFixtureBundle> => {
  const manifest = await loadVisualBenchmarkFixtureManifest(fixtureId, options);
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId, options);
  const referenceBuffer = await loadVisualBenchmarkReference(fixtureId, options);

  return {
    manifest,
    metadata,
    figmaInput,
    referenceBuffer
  };
};

export const writeVisualBenchmarkFixtureManifest = async (
  fixtureId: string,
  manifest: VisualBenchmarkFixtureManifest,
  options?: VisualBenchmarkFixtureOptions
): Promise<void> => {
  const { manifestJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  await mkdir(path.dirname(manifestJsonPath), { recursive: true });
  await writeFile(manifestJsonPath, toStableJsonString(manifest), "utf8");
};

export const writeVisualBenchmarkFixtureMetadata = async (
  fixtureId: string,
  metadata: VisualBenchmarkFixtureMetadata,
  options?: VisualBenchmarkFixtureOptions
): Promise<void> => {
  const { metadataJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  await mkdir(path.dirname(metadataJsonPath), { recursive: true });
  await writeFile(metadataJsonPath, toStableJsonString(metadata), "utf8");
};

export const writeVisualBenchmarkFixtureInputs = async (
  fixtureId: string,
  figmaInput: unknown,
  options?: VisualBenchmarkFixtureOptions
): Promise<void> => {
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  await mkdir(path.dirname(figmaJsonPath), { recursive: true });
  await writeFile(figmaJsonPath, toStableJsonString(figmaInput), "utf8");
};

export const writeVisualBenchmarkReference = async (
  fixtureId: string,
  buffer: Buffer,
  options?: VisualBenchmarkFixtureOptions
): Promise<void> => {
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Refusing to write invalid PNG for fixture '${fixtureId}'.`);
  }
  const { referencePngPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  await mkdir(path.dirname(referencePngPath), { recursive: true });
  await writeFile(referencePngPath, buffer);
};
