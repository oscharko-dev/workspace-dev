import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(MODULE_DIR, "fixtures", "visual-benchmark");
const FIGMA_JSON_FILE_NAME = "figma.json";
const MANIFEST_JSON_FILE_NAME = "manifest.json";
const METADATA_JSON_FILE_NAME = "metadata.json";
const REFERENCE_PNG_FILE_NAME = "reference.png";
const SCREENS_DIR_NAME = "screens";
const ALLOWED_SCREEN_ID_PATTERN = /^[A-Za-z0-9:_\-]+$/u;
export const ALLOWED_VIEWPORT_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

const FORBIDDEN_FIXTURE_PATH_SEGMENTS = [
  "storybook-static",
  ".zip",
  "..",
] as const;

const PNG_MAGIC_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const SCREEN_ID_TOKEN_ESCAPE = "~";
const SCREEN_ID_TOKEN_UNDERSCORE_ESCAPE = `${SCREEN_ID_TOKEN_ESCAPE}u`;

export interface VisualBenchmarkViewport {
  width: number;
  height: number;
  readonly deviceScaleFactor?: number;
}

export interface VisualBenchmarkViewportSpec {
  id: string;
  label?: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  weight?: number;
}

export interface VisualBenchmarkExportConfig {
  format: "png";
  scale: number;
}

export type VisualBenchmarkFixtureMode =
  | "generated_app_screen"
  | "storybook_component";

export type VisualBenchmarkStorybookCaptureStrategy = "storybook_root_union";

export interface VisualBenchmarkBaselineCanvas {
  width: number;
  height: number;
}

export interface VisualBenchmarkFixtureSource {
  fileKey: string;
  nodeId: string;
  nodeName: string;
  lastModified: string;
}

export interface VisualBenchmarkFixtureScreenMetadata {
  screenId: string;
  screenName: string;
  nodeId: string;
  viewport: VisualBenchmarkViewport;
  weight?: number;
  viewports?: VisualBenchmarkViewportSpec[];
  entryId?: string;
  storyTitle?: string;
  referenceNodeId?: string;
  referenceFileKey?: string;
  captureStrategy?: VisualBenchmarkStorybookCaptureStrategy;
  baselineCanvas?: VisualBenchmarkBaselineCanvas;
}

export interface VisualBenchmarkFixtureMetadata {
  version: 1 | 2 | 3 | 4;
  fixtureId: string;
  capturedAt: string;
  source: VisualBenchmarkFixtureSource;
  viewport: VisualBenchmarkViewport;
  export: VisualBenchmarkExportConfig;
  screens?: VisualBenchmarkFixtureScreenMetadata[];
  mode?: VisualBenchmarkFixtureMode;
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

export interface VisualBenchmarkFixtureScreenPaths {
  screenDir: string;
  referencePngPath: string;
}

export interface VisualBenchmarkFixtureScreenViewportPaths {
  screenDir: string;
  referencePngPath: string;
}

export interface VisualBenchmarkFixtureOptions {
  fixtureRoot?: string;
  artifactRoot?: string;
}

export interface VisualBenchmarkAggregateScoreLike {
  score: number;
  weight?: number;
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

  const sortedEntries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
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

const parsePositiveInteger = (value: unknown, fieldName: string): number => {
  const parsed = parsePositiveNumber(value, fieldName);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
};

const parseScreenViewports = (
  raw: unknown,
  fixtureId: string,
  screenId: string,
): VisualBenchmarkViewportSpec[] => {
  if (!Array.isArray(raw)) {
    throw new Error(
      `visual-benchmark metadata screens.viewports for fixture '${fixtureId}' screen '${screenId}' must be an array.`,
    );
  }
  const out: VisualBenchmarkViewportSpec[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isPlainRecord(entry)) {
      throw new Error(
        `visual-benchmark metadata screens.viewports entry for fixture '${fixtureId}' screen '${screenId}' must be an object.`,
      );
    }
    const id = assertAllowedViewportId(entry.id);
    if (seen.has(id)) {
      throw new Error(
        `visual-benchmark metadata fixture '${fixtureId}' screen '${screenId}' has duplicate viewport id '${id}'.`,
      );
    }
    seen.add(id);
    const width = parsePositiveInteger(
      entry.width,
      `visual-benchmark metadata screens.viewports.width`,
    );
    const height = parsePositiveInteger(
      entry.height,
      `visual-benchmark metadata screens.viewports.height`,
    );
    const spec: VisualBenchmarkViewportSpec = { id, width, height };
    if (entry.label !== undefined) {
      const label = parseRequiredString(
        entry.label,
        `visual-benchmark metadata screens.viewports.label`,
      );
      spec.label = label;
    }
    if (entry.deviceScaleFactor !== undefined) {
      spec.deviceScaleFactor = parsePositiveNumber(
        entry.deviceScaleFactor,
        `visual-benchmark metadata screens.viewports.deviceScaleFactor`,
      );
    }
    if (entry.weight !== undefined) {
      spec.weight = parsePositiveNumber(
        entry.weight,
        `visual-benchmark metadata screens.viewports.weight`,
      );
    }
    out.push(spec);
  }
  return out;
};

const parseScreens = (
  raw: unknown,
  fixtureId: string,
  parseViewports: boolean,
  options?: {
    mode?: VisualBenchmarkFixtureMode;
    version?: 1 | 2 | 3 | 4;
  },
): VisualBenchmarkFixtureScreenMetadata[] => {
  if (!Array.isArray(raw)) {
    throw new Error(
      `visual-benchmark metadata screens for fixture '${fixtureId}' must be an array.`,
    );
  }
  const out: VisualBenchmarkFixtureScreenMetadata[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isPlainRecord(entry)) {
      throw new Error(
        `visual-benchmark metadata screens entry for fixture '${fixtureId}' must be an object.`,
      );
    }
    const screenId = assertAllowedScreenId(
      parseRequiredString(
        entry.screenId,
        `visual-benchmark metadata screens.screenId`,
      ),
    );
    if (seen.has(screenId)) {
      throw new Error(
        `visual-benchmark metadata fixture '${fixtureId}' has duplicate screenId '${screenId}'.`,
      );
    }
    seen.add(screenId);
    const screenName = parseRequiredString(
      entry.screenName,
      `visual-benchmark metadata screens.screenName`,
    );
    const nodeId = parseRequiredString(
      entry.nodeId,
      `visual-benchmark metadata screens.nodeId`,
    );
    const viewport = entry.viewport;
    if (!isPlainRecord(viewport)) {
      throw new Error(
        `visual-benchmark metadata screens.viewport for fixture '${fixtureId}' must be an object.`,
      );
    }
    const width = parsePositiveNumber(
      viewport.width,
      `visual-benchmark metadata screens.viewport.width`,
    );
    const height = parsePositiveNumber(
      viewport.height,
      `visual-benchmark metadata screens.viewport.height`,
    );
    const screen: VisualBenchmarkFixtureScreenMetadata = {
      screenId,
      screenName,
      nodeId,
      viewport: { width, height },
    };
    if (entry.weight !== undefined) {
      const weight = Number(entry.weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(
          `visual-benchmark metadata screens.weight for fixture '${fixtureId}' must be a positive finite number.`,
        );
      }
      screen.weight = weight;
    }
    if (parseViewports && entry.viewports !== undefined) {
      screen.viewports = parseScreenViewports(
        entry.viewports,
        fixtureId,
        screenId,
      );
    }
    if (options?.version === 4 && options.mode === "storybook_component") {
      if (entry.entryId !== undefined) {
        screen.entryId = parseRequiredString(
          entry.entryId,
          `visual-benchmark metadata screens.entryId`,
        );
      }
      if (entry.storyTitle !== undefined) {
        screen.storyTitle = parseRequiredString(
          entry.storyTitle,
          `visual-benchmark metadata screens.storyTitle`,
        );
      }
      if (entry.referenceNodeId !== undefined) {
        screen.referenceNodeId = parseRequiredString(
          entry.referenceNodeId,
          `visual-benchmark metadata screens.referenceNodeId`,
        );
      }
      if (entry.referenceFileKey !== undefined) {
        screen.referenceFileKey = parseRequiredString(
          entry.referenceFileKey,
          `visual-benchmark metadata screens.referenceFileKey`,
        );
      }
      if (entry.captureStrategy !== undefined) {
        const captureStrategy = parseRequiredString(
          entry.captureStrategy,
          `visual-benchmark metadata screens.captureStrategy`,
        );
        if (captureStrategy !== "storybook_root_union") {
          throw new Error(
            `visual-benchmark metadata screens.captureStrategy for fixture '${fixtureId}' screen '${screenId}' must be 'storybook_root_union'.`,
          );
        }
        screen.captureStrategy = "storybook_root_union";
      }
      if (entry.baselineCanvas !== undefined) {
        if (!isPlainRecord(entry.baselineCanvas)) {
          throw new Error(
            `visual-benchmark metadata screens.baselineCanvas for fixture '${fixtureId}' screen '${screenId}' must be an object.`,
          );
        }
        if (
          entry.baselineCanvas.width !== undefined ||
          entry.baselineCanvas.height !== undefined
        ) {
          screen.baselineCanvas = {
            width: parsePositiveInteger(
              entry.baselineCanvas.width,
              `visual-benchmark metadata screens.baselineCanvas.width`,
            ),
            height: parsePositiveInteger(
              entry.baselineCanvas.height,
              `visual-benchmark metadata screens.baselineCanvas.height`,
            ),
          };
        } else if (entry.baselineCanvas.padding !== undefined) {
          parsePositiveInteger(
            entry.baselineCanvas.padding,
            `visual-benchmark metadata screens.baselineCanvas.padding`,
          );
          screen.baselineCanvas = {
            width: Math.round(screen.viewport.width),
            height: Math.round(screen.viewport.height),
          };
        } else {
          throw new Error(
            `visual-benchmark metadata screens.baselineCanvas for fixture '${fixtureId}' screen '${screenId}' must contain width and height or a padding value.`,
          );
        }
      }
    }
    out.push(screen);
  }
  return out;
};

export const parseVisualBenchmarkFixtureMetadata = (
  input: string,
): VisualBenchmarkFixtureMetadata => {
  const parsed = JSON.parse(input) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected visual-benchmark metadata to be an object.");
  }
  if (
    parsed.version !== 1 &&
    parsed.version !== 2 &&
    parsed.version !== 3 &&
    parsed.version !== 4
  ) {
    throw new Error("visual-benchmark metadata version must be 1, 2, 3, or 4.");
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

  const format = parseRequiredString(
    exportConfig.format,
    "visual-benchmark metadata export.format",
  );
  if (format !== "png") {
    throw new Error("visual-benchmark metadata export.format must be 'png'.");
  }

  const fixtureId = parseRequiredString(
    parsed.fixtureId,
    "visual-benchmark metadata fixtureId",
  );
  let mode: VisualBenchmarkFixtureMode | undefined;
  if (parsed.version === 4) {
    mode = parseRequiredString(
      parsed.mode,
      "visual-benchmark metadata mode",
    ) as VisualBenchmarkFixtureMode;
    if (mode !== "generated_app_screen" && mode !== "storybook_component") {
      throw new Error(
        "visual-benchmark metadata mode must be 'generated_app_screen' or 'storybook_component'.",
      );
    }
  }

  const base: VisualBenchmarkFixtureMetadata = {
    version: parsed.version,
    fixtureId,
    capturedAt: parseRequiredString(
      parsed.capturedAt,
      "visual-benchmark metadata capturedAt",
    ),
    source: {
      fileKey: parseRequiredString(
        source.fileKey,
        "visual-benchmark metadata source.fileKey",
      ),
      nodeId: parseRequiredString(
        source.nodeId,
        "visual-benchmark metadata source.nodeId",
      ),
      nodeName: parseRequiredString(
        source.nodeName,
        "visual-benchmark metadata source.nodeName",
      ),
      lastModified: parseRequiredString(
        source.lastModified,
        "visual-benchmark metadata source.lastModified",
      ),
    },
    viewport: {
      width: parsePositiveNumber(
        viewport.width,
        "visual-benchmark metadata viewport.width",
      ),
      height: parsePositiveNumber(
        viewport.height,
        "visual-benchmark metadata viewport.height",
      ),
      deviceScaleFactor:
        viewport.deviceScaleFactor === undefined
          ? 1
          : parsePositiveNumber(
              viewport.deviceScaleFactor,
              "visual-benchmark metadata viewport.deviceScaleFactor",
            ),
    },
    export: {
      format: "png",
      scale: parsePositiveNumber(
        exportConfig.scale,
        "visual-benchmark metadata export.scale",
      ),
    },
    ...(mode !== undefined ? { mode } : {}),
  };

  if (
    (parsed.version === 2 || parsed.version === 3 || parsed.version === 4) &&
    parsed.screens !== undefined
  ) {
    base.screens = parseScreens(
      parsed.screens,
      fixtureId,
      parsed.version === 3 || parsed.version === 4,
      { version: parsed.version, ...(mode !== undefined ? { mode } : {}) },
    );
  }

  return base;
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
    throw new Error(
      "visual-benchmark manifest visualQuality section is required.",
    );
  }
  return {
    version: 1,
    fixtureId: parseRequiredString(
      parsed.fixtureId,
      "visual-benchmark manifest fixtureId",
    ),
    visualQuality: {
      frozenReferenceImage: parseRequiredString(
        visualQuality.frozenReferenceImage,
        "visual-benchmark manifest visualQuality.frozenReferenceImage",
      ),
      frozenReferenceMetadata: parseRequiredString(
        visualQuality.frozenReferenceMetadata,
        "visual-benchmark manifest visualQuality.frozenReferenceMetadata",
      ),
    },
  };
};

const resolveFixtureRoot = (
  options?: VisualBenchmarkFixtureOptions,
): string => {
  return options?.fixtureRoot ?? FIXTURE_ROOT;
};

export const toStableJsonString = (value: unknown): string =>
  `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;

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
      throw new Error(
        `Fixture path '${normalized}' contains forbidden segment '${forbiddenSegment}'.`,
      );
    }
  }
  return normalized;
};

export const assertAllowedFixtureId = (value: string): string => {
  const normalized = assertAllowedFixturePath(value);
  if (normalized.includes("/")) {
    throw new Error(
      `Fixture id '${normalized}' must not contain path separators.`,
    );
  }
  return normalized;
};

export function assertAllowedScreenId(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Screen id must be a non-empty string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Screen id must be a non-empty string.");
  }
  if (trimmed === ".." || trimmed.includes("..")) {
    throw new Error(
      `Screen id '${trimmed}' contains forbidden segment '..' (not allowed).`,
    );
  }
  if (!ALLOWED_SCREEN_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Screen id '${trimmed}' contains invalid characters (allowed: A-Z, a-z, 0-9, ':', '_', '-').`,
    );
  }
  return trimmed;
}

export function assertAllowedViewportId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Viewport id must be a non-empty string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Viewport id must be a non-empty string.");
  }
  if (trimmed === ".." || trimmed.includes("..")) {
    throw new Error(
      `Viewport id '${trimmed}' contains forbidden segment '..' (not allowed).`,
    );
  }
  if (!ALLOWED_VIEWPORT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Viewport id '${trimmed}' contains invalid characters (allowed: A-Z, a-z, 0-9, '_', '-').`,
    );
  }
  return trimmed;
}

export const toScreenIdToken = (screenId: string): string =>
  assertAllowedScreenId(screenId)
    .replace(/_/gu, SCREEN_ID_TOKEN_UNDERSCORE_ESCAPE)
    .replace(/:/gu, "_");

export const fromScreenIdToken = (token: string): string => {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Screen id token must be a non-empty string.");
  }
  const trimmed = token.trim();
  if (!trimmed.includes(SCREEN_ID_TOKEN_ESCAPE)) {
    return assertAllowedScreenId(trimmed.replace(/_/gu, ":"));
  }

  let decoded = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "_") {
      decoded += ":";
      continue;
    }
    if (character !== SCREEN_ID_TOKEN_ESCAPE) {
      decoded += character;
      continue;
    }

    const escapeSequence = trimmed.slice(index, index + 2);
    if (escapeSequence === SCREEN_ID_TOKEN_UNDERSCORE_ESCAPE) {
      decoded += "_";
      index += 1;
      continue;
    }

    throw new Error(`Unsupported screen id token escape '${escapeSequence}'.`);
  }

  return assertAllowedScreenId(decoded);
};

export const computeVisualBenchmarkAggregateScore = (
  screens: readonly VisualBenchmarkAggregateScoreLike[],
): number => {
  if (screens.length === 0) {
    throw new Error(
      "computeVisualBenchmarkAggregateScore requires at least one screen.",
    );
  }

  const hasDeclaredWeight = screens.some(
    (screen) => screen.weight !== undefined,
  );
  if (!hasDeclaredWeight) {
    const total = screens.reduce((sum, screen) => sum + screen.score, 0);
    return Math.round((total / screens.length) * 100) / 100;
  }

  let weightedScoreTotal = 0;
  let weightTotal = 0;
  for (const screen of screens) {
    const weight = screen.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(
        "computeVisualBenchmarkAggregateScore weights must be positive finite numbers.",
      );
    }
    weightedScoreTotal += screen.score * weight;
    weightTotal += weight;
  }

  return Math.round((weightedScoreTotal / weightTotal) * 100) / 100;
};

export const normalizeOptionalScreenName = (
  screenName: string | undefined,
): string | undefined => {
  if (typeof screenName !== "string") {
    return undefined;
  }
  const normalized = screenName.trim();
  return normalized.length > 0 ? normalized : undefined;
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
  options?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkFixturePaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const fixtureDir = path.join(
    resolveFixtureRoot(options),
    normalizedFixtureId,
  );
  return {
    fixtureDir,
    figmaJsonPath: path.join(fixtureDir, FIGMA_JSON_FILE_NAME),
    manifestJsonPath: path.join(fixtureDir, MANIFEST_JSON_FILE_NAME),
    metadataJsonPath: path.join(fixtureDir, METADATA_JSON_FILE_NAME),
    referencePngPath: path.join(fixtureDir, REFERENCE_PNG_FILE_NAME),
  };
};

export const resolveVisualBenchmarkScreenPaths = (
  fixtureId: string,
  screenId: string,
  options?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkFixtureScreenPaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const normalizedScreenId = assertAllowedScreenId(screenId);
  const token = toScreenIdToken(normalizedScreenId);
  const fixtureDir = path.join(
    resolveFixtureRoot(options),
    normalizedFixtureId,
  );
  const screenDir = path.join(fixtureDir, SCREENS_DIR_NAME, token);
  return {
    screenDir,
    referencePngPath: path.join(screenDir, REFERENCE_PNG_FILE_NAME),
  };
};

export const resolveVisualBenchmarkScreenViewportPaths = (
  fixtureId: string,
  screenId: string,
  viewportId: string,
  options?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkFixtureScreenViewportPaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const normalizedScreenId = assertAllowedScreenId(screenId);
  const normalizedViewportId = assertAllowedViewportId(viewportId);
  const token = toScreenIdToken(normalizedScreenId);
  const fixtureDir = path.join(
    resolveFixtureRoot(options),
    normalizedFixtureId,
  );
  const screenDir = path.join(fixtureDir, SCREENS_DIR_NAME, token);
  return {
    screenDir,
    referencePngPath: path.join(screenDir, `${normalizedViewportId}.png`),
  };
};

const cloneViewportSpec = (
  viewport: VisualBenchmarkViewportSpec,
): VisualBenchmarkViewportSpec => {
  const clone: VisualBenchmarkViewportSpec = {
    id: viewport.id,
    width: viewport.width,
    height: viewport.height,
  };
  if (viewport.label !== undefined) {
    clone.label = viewport.label;
  }
  if (viewport.deviceScaleFactor !== undefined) {
    clone.deviceScaleFactor = viewport.deviceScaleFactor;
  }
  if (viewport.weight !== undefined) {
    clone.weight = viewport.weight;
  }
  return clone;
};

export const enumerateFixtureScreens = (
  metadata: VisualBenchmarkFixtureMetadata,
): VisualBenchmarkFixtureScreenMetadata[] => {
  if (
    (metadata.version === 2 ||
      metadata.version === 3 ||
      metadata.version === 4) &&
    Array.isArray(metadata.screens) &&
    metadata.screens.length > 0
  ) {
    return metadata.screens.map((screen) => {
      const clone: VisualBenchmarkFixtureScreenMetadata = {
        screenId: screen.screenId,
        screenName: screen.screenName,
        nodeId: screen.nodeId,
        viewport: {
          width: screen.viewport.width,
          height: screen.viewport.height,
        },
      };
      if (screen.weight !== undefined) {
        clone.weight = screen.weight;
      }
      if (screen.viewports !== undefined) {
        clone.viewports = screen.viewports.map((viewport) =>
          cloneViewportSpec(viewport),
        );
      }
      if (screen.entryId !== undefined) {
        clone.entryId = screen.entryId;
      }
      if (screen.storyTitle !== undefined) {
        clone.storyTitle = screen.storyTitle;
      }
      if (screen.referenceNodeId !== undefined) {
        clone.referenceNodeId = screen.referenceNodeId;
      }
      if (screen.referenceFileKey !== undefined) {
        clone.referenceFileKey = screen.referenceFileKey;
      }
      if (screen.captureStrategy !== undefined) {
        clone.captureStrategy = screen.captureStrategy;
      }
      if (screen.baselineCanvas !== undefined) {
        clone.baselineCanvas = {
          width: screen.baselineCanvas.width,
          height: screen.baselineCanvas.height,
        };
      }
      return clone;
    });
  }
  return [
    {
      screenId: metadata.source.nodeId,
      screenName: metadata.source.nodeName,
      nodeId: metadata.source.nodeId,
      viewport: {
        width: metadata.viewport.width,
        height: metadata.viewport.height,
      },
    },
  ];
};

export const enumerateFixtureScreenViewports = (
  screen: VisualBenchmarkFixtureScreenMetadata,
  defaultList: readonly VisualBenchmarkViewportSpec[],
): VisualBenchmarkViewportSpec[] => {
  if (screen.viewports !== undefined && screen.viewports.length > 0) {
    return screen.viewports.map((viewport) => cloneViewportSpec(viewport));
  }
  if (defaultList.length > 0) {
    return defaultList.map((viewport) => cloneViewportSpec(viewport));
  }
  return [
    {
      id: "default",
      width: screen.viewport.width,
      height: screen.viewport.height,
      deviceScaleFactor: 1,
    },
  ];
};

export const listVisualBenchmarkFixtureIds = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<string[]> => {
  const entries = await readdir(resolveFixtureRoot(options), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const loadVisualBenchmarkFixtureMetadata = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkFixtureMetadata> => {
  const { metadataJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const content = await readFile(metadataJsonPath, "utf8");
  const metadata = parseVisualBenchmarkFixtureMetadata(content);
  assert.equal(
    metadata.fixtureId,
    fixtureId,
    `Metadata fixtureId '${metadata.fixtureId}' does not match directory name '${fixtureId}'.`,
  );
  return metadata;
};

export const loadVisualBenchmarkFixtureManifest = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkFixtureManifest> => {
  const { manifestJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const content = await readFile(manifestJsonPath, "utf8");
  const manifest = parseManifest(content);
  assert.equal(
    manifest.fixtureId,
    fixtureId,
    `Manifest fixtureId '${manifest.fixtureId}' does not match directory name '${fixtureId}'.`,
  );
  return manifest;
};

export const loadVisualBenchmarkFixtureInputs = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<unknown> => {
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const content = await readFile(figmaJsonPath, "utf8");
  return JSON.parse(content) as unknown;
};

export const loadVisualBenchmarkReference = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<Buffer> => {
  const { referencePngPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const buffer = await readFile(referencePngPath);
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Reference for fixture '${fixtureId}' is not a valid PNG.`);
  }
  return buffer;
};

export const loadVisualBenchmarkFixtureBundle = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkFixtureBundle> => {
  const manifest = await loadVisualBenchmarkFixtureManifest(fixtureId, options);
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId, options);
  const referenceBuffer = await loadVisualBenchmarkReference(
    fixtureId,
    options,
  );

  return {
    manifest,
    metadata,
    figmaInput,
    referenceBuffer,
  };
};

export const writeVisualBenchmarkFixtureManifest = async (
  fixtureId: string,
  manifest: VisualBenchmarkFixtureManifest,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const { manifestJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  await mkdir(path.dirname(manifestJsonPath), { recursive: true });
  await writeFile(manifestJsonPath, toStableJsonString(manifest), "utf8");
};

export const writeVisualBenchmarkFixtureMetadata = async (
  fixtureId: string,
  metadata: VisualBenchmarkFixtureMetadata,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const { metadataJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  await mkdir(path.dirname(metadataJsonPath), { recursive: true });
  await writeFile(metadataJsonPath, toStableJsonString(metadata), "utf8");
};

export const writeVisualBenchmarkFixtureInputs = async (
  fixtureId: string,
  figmaInput: unknown,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  await mkdir(path.dirname(figmaJsonPath), { recursive: true });
  await writeFile(figmaJsonPath, toStableJsonString(figmaInput), "utf8");
};

export const writeVisualBenchmarkReference = async (
  fixtureId: string,
  buffer: Buffer,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  if (!isValidPngBuffer(buffer)) {
    throw new Error(
      `Refusing to write invalid PNG for fixture '${fixtureId}'.`,
    );
  }
  const { referencePngPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  await mkdir(path.dirname(referencePngPath), { recursive: true });
  await writeFile(referencePngPath, buffer);
};
