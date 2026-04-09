import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(MODULE_DIR, "fixtures", "visual-benchmark");

const FORBIDDEN_FIXTURE_PATH_SEGMENTS = [
  "storybook-static",
  ".zip",
  ".."
] as const;

const PNG_MAGIC_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualBenchmarkViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface VisualBenchmarkCaptureConfig {
  waitForNetworkIdle: boolean;
  waitForFonts: boolean;
  waitForAnimations: boolean;
  fullPage: boolean;
}

export interface VisualBenchmarkReferenceSpec {
  name: string;
  path: string;
  capturedAt: string;
  viewport: VisualBenchmarkViewport;
  captureConfig: VisualBenchmarkCaptureConfig;
}

export interface VisualBenchmarkManifest {
  version: 1;
  fixtureId: string;
  inputs: {
    figma: string;
  };
  references: VisualBenchmarkReferenceSpec[];
}

export interface VisualBenchmarkFixtureBundle {
  manifest: VisualBenchmarkManifest;
  figmaInput: unknown;
  referenceBuffers: Map<string, Buffer>;
}

// ---------------------------------------------------------------------------
// Stable JSON helpers (reused from customer-board-golden pattern)
// ---------------------------------------------------------------------------

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
  const sorted = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of sorted) {
    output[key] = toStableJsonValue(entryValue);
  }
  return output;
};

export const toStableJsonString = (value: unknown): string => `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;

// ---------------------------------------------------------------------------
// Path validation (reused from customer-board-golden pattern)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PNG validation
// ---------------------------------------------------------------------------

export const isValidPngBuffer = (buffer: Buffer): boolean => {
  if (buffer.length < 4) {
    return false;
  }
  for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
    if (buffer[i] !== PNG_MAGIC_BYTES[i]) {
      return false;
    }
  }
  return true;
};

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

const parseReferenceSpec = (entry: unknown, index: number): VisualBenchmarkReferenceSpec => {
  if (!isPlainRecord(entry)) {
    throw new Error(`visual-benchmark manifest references[${index}] must be an object.`);
  }

  const viewport = entry.viewport;
  if (!isPlainRecord(viewport)) {
    throw new Error(`visual-benchmark manifest references[${index}].viewport must be an object.`);
  }

  const captureConfig = entry.captureConfig;
  if (!isPlainRecord(captureConfig)) {
    throw new Error(`visual-benchmark manifest references[${index}].captureConfig must be an object.`);
  }

  const name = String(entry.name ?? "");
  if (name.length === 0) {
    throw new Error(`visual-benchmark manifest references[${index}].name must not be empty.`);
  }

  const capturedAt = String(entry.capturedAt ?? "");
  if (capturedAt.length === 0) {
    throw new Error(`visual-benchmark manifest references[${index}].capturedAt must not be empty.`);
  }

  return {
    name,
    path: assertAllowedFixturePath(String(entry.path ?? "")),
    capturedAt,
    viewport: {
      width: Number(viewport.width),
      height: Number(viewport.height),
      deviceScaleFactor: Number(viewport.deviceScaleFactor)
    },
    captureConfig: {
      waitForNetworkIdle: Boolean(captureConfig.waitForNetworkIdle),
      waitForFonts: Boolean(captureConfig.waitForFonts),
      waitForAnimations: Boolean(captureConfig.waitForAnimations),
      fullPage: Boolean(captureConfig.fullPage)
    }
  };
};

const parseManifest = (input: string): VisualBenchmarkManifest => {
  const parsed = JSON.parse(input) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected visual-benchmark manifest to be an object.");
  }

  if (parsed.version !== 1) {
    throw new Error("visual-benchmark manifest version must be 1.");
  }

  const fixtureId = parsed.fixtureId;
  if (typeof fixtureId !== "string" || fixtureId.length === 0) {
    throw new Error("visual-benchmark manifest fixtureId must be a non-empty string.");
  }

  const inputs = parsed.inputs;
  if (!isPlainRecord(inputs)) {
    throw new Error("visual-benchmark manifest inputs section is required.");
  }

  const references = parsed.references;
  if (!Array.isArray(references)) {
    throw new Error("visual-benchmark manifest references must be an array.");
  }

  return {
    version: 1,
    fixtureId,
    inputs: {
      figma: assertAllowedFixturePath(String(inputs.figma ?? ""))
    },
    references: references.map((entry, index) => parseReferenceSpec(entry, index))
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const getVisualBenchmarkFixtureRoot = (): string => FIXTURE_ROOT;

export const listVisualBenchmarkFixtureIds = async (): Promise<string[]> => {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const loadVisualBenchmarkManifest = async (fixtureId: string): Promise<VisualBenchmarkManifest> => {
  const manifestPath = path.join(FIXTURE_ROOT, fixtureId, "manifest.json");
  const content = await readFile(manifestPath, "utf8");
  const manifest = parseManifest(content);
  assert.equal(
    manifest.fixtureId,
    fixtureId,
    `Manifest fixtureId '${manifest.fixtureId}' does not match directory name '${fixtureId}'.`
  );
  return manifest;
};

export const loadVisualBenchmarkFixtureInputs = async (fixtureId: string): Promise<unknown> => {
  const manifest = await loadVisualBenchmarkManifest(fixtureId);
  const figmaPath = path.join(FIXTURE_ROOT, fixtureId, manifest.inputs.figma);
  const content = await readFile(figmaPath, "utf8");
  return JSON.parse(content) as unknown;
};

export const loadVisualBenchmarkReference = async (fixtureId: string, refName: string): Promise<Buffer> => {
  const manifest = await loadVisualBenchmarkManifest(fixtureId);
  const refSpec = manifest.references.find((ref) => ref.name === refName);
  if (!refSpec) {
    throw new Error(`Reference '${refName}' not found in fixture '${fixtureId}'.`);
  }
  const refPath = path.join(FIXTURE_ROOT, fixtureId, refSpec.path);
  const buffer = await readFile(refPath);
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Reference '${refName}' in fixture '${fixtureId}' is not a valid PNG.`);
  }
  return buffer;
};

export const loadVisualBenchmarkFixtureBundle = async (fixtureId: string): Promise<VisualBenchmarkFixtureBundle> => {
  const manifest = await loadVisualBenchmarkManifest(fixtureId);
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId);
  const referenceBuffers = new Map<string, Buffer>();

  for (const refSpec of manifest.references) {
    const refPath = path.join(FIXTURE_ROOT, fixtureId, refSpec.path);
    const buffer = await readFile(refPath);
    if (!isValidPngBuffer(buffer)) {
      throw new Error(`Reference '${refSpec.name}' in fixture '${fixtureId}' is not a valid PNG.`);
    }
    referenceBuffers.set(refSpec.name, buffer);
  }

  return {
    manifest,
    figmaInput,
    referenceBuffers
  };
};

export const writeVisualBenchmarkManifest = async (fixtureId: string, manifest: VisualBenchmarkManifest): Promise<void> => {
  const manifestPath = path.join(FIXTURE_ROOT, fixtureId, "manifest.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, toStableJsonString(manifest), "utf8");
};

export const writeVisualBenchmarkReference = async (
  fixtureId: string,
  refSpec: VisualBenchmarkReferenceSpec,
  buffer: Buffer
): Promise<void> => {
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Refusing to write invalid PNG for reference '${refSpec.name}' in fixture '${fixtureId}'.`);
  }
  const refPath = path.join(FIXTURE_ROOT, fixtureId, assertAllowedFixturePath(refSpec.path));
  await mkdir(path.dirname(refPath), { recursive: true });
  await writeFile(refPath, buffer);
};
