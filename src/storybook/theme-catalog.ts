import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractCssCustomPropertyDefinitions } from "./bundle-analysis.js";
import {
  createEvaluationState,
  createJsEvaluationEnvironment,
  evaluateJsExpression,
  isJsStaticArrayValue,
  isJsStaticNumberValue,
  isJsStaticObjectValue,
  isJsStaticStringValue,
  type JsStaticValue
} from "./js-subset-evaluator.js";
import {
  extractStaticObjectFieldDetails,
  mergeStaticJsonRecords,
  type StaticJsonValue
} from "./static-object-field.js";
import { extractTopLevelObjectKeys, normalizePosixPath, uniqueSorted } from "./text.js";
import type {
  StorybookEvidenceItem,
  StorybookExtractedTheme,
  StorybookSanitizedEvidenceReference,
  StorybookThemeCandidate,
  StorybookThemeCatalog,
  StorybookThemeDiagnostic,
  StorybookThemeDiagnosticSeverity,
  StorybookTokenAliasReference,
  StorybookTokenClass,
  StorybookTokenGraphEntry,
  StorybookTokenValueType
} from "./types.js";

const STRONG_THEME_KEYS = new Set([
  "palette",
  "colorSchemes",
  "typography",
  "spacing",
  "shape",
  "components",
  "zIndex",
  "transitions",
  "shadows"
]);
const COLOR_PROPERTY_KEYS = new Set(["color", "backgroundColor", "borderColor", "fill", "stroke"]);
const SPACING_PROPERTY_KEYS = new Set(["spacing", "gap", "rowGap", "columnGap"]);
const DIMENSION_PROPERTY_KEYS = new Set(["width", "height"]);
const TYPOGRAPHY_PROPERTY_KEYS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform"
]);
const REQUIRED_THEME_CATEGORIES = new Set(["color", "spacing"]);
const THEME_CONTEXT_PREFIX = "theme";
const FONT_CONTEXT_PREFIX = "font";
const STORYBACKFILL_CONTEXT_PREFIX = "stories";
const CSS_CONTEXT_PREFIX = "css";

const NAMED_CSS_COLORS: ReadonlyMap<string, { components: [number, number, number]; alpha?: number }> = new Map([
  ["transparent", { components: [0, 0, 0], alpha: 0 }],
  ["aqua", { components: [0, 1, 1] }],
  ["beige", { components: [0.9607843137254902, 0.9607843137254902, 0.8627450980392157] }],
  ["bisque", { components: [1, 0.8941176470588236, 0.7686274509803922] }],
  ["black", { components: [0, 0, 0] }],
  ["blue", { components: [0, 0, 1] }],
  ["brown", { components: [0.6470588235294118, 0.16470588235294117, 0.16470588235294117] }],
  ["coral", { components: [1, 0.4980392156862745, 0.3137254901960784] }],
  ["cornsilk", { components: [1, 0.9725490196078431, 0.8627450980392157] }],
  ["crimson", { components: [0.8627450980392157, 0.0784313725490196, 0.23529411764705882] }],
  ["cyan", { components: [0, 1, 1] }],
  ["darkblue", { components: [0, 0, 0.5450980392156862] }],
  ["darkgray", { components: [0.6627450980392157, 0.6627450980392157, 0.6627450980392157] }],
  ["darkgreen", { components: [0, 0.39215686274509803, 0] }],
  ["darkgrey", { components: [0.6627450980392157, 0.6627450980392157, 0.6627450980392157] }],
  ["darkred", { components: [0.5450980392156862, 0, 0] }],
  ["dimgray", { components: [0.4117647058823529, 0.4117647058823529, 0.4117647058823529] }],
  ["dimgrey", { components: [0.4117647058823529, 0.4117647058823529, 0.4117647058823529] }],
  ["fuchsia", { components: [1, 0, 1] }],
  ["gold", { components: [1, 0.8431372549019608, 0] }],
  ["goldenrod", { components: [0.8549019607843137, 0.6470588235294118, 0.12549019607843137] }],
  ["gray", { components: [0.5019607843137255, 0.5019607843137255, 0.5019607843137255] }],
  ["green", { components: [0, 0.5019607843137255, 0] }],
  ["grey", { components: [0.5019607843137255, 0.5019607843137255, 0.5019607843137255] }],
  ["hotpink", { components: [1, 0.4117647058823529, 0.7058823529411765] }],
  ["indigo", { components: [0.29411764705882354, 0, 0.5098039215686275] }],
  ["ivory", { components: [1, 1, 0.9411764705882353] }],
  ["khaki", { components: [0.9411764705882353, 0.9019607843137255, 0.5490196078431373] }],
  ["lavender", { components: [0.9019607843137255, 0.9019607843137255, 0.9803921568627451] }],
  ["lime", { components: [0, 1, 0] }],
  ["limegreen", { components: [0.19607843137254902, 0.803921568627451, 0.19607843137254902] }],
  ["magenta", { components: [1, 0, 1] }],
  ["maroon", { components: [0.5019607843137255, 0, 0] }],
  ["midnightblue", { components: [0.09803921568627451, 0.09803921568627451, 0.4392156862745098] }],
  ["mintcream", { components: [0.9607843137254902, 1, 0.9803921568627451] }],
  ["navy", { components: [0, 0, 0.5019607843137255] }],
  ["olive", { components: [0.5019607843137255, 0.5019607843137255, 0] }],
  ["orange", { components: [1, 0.6470588235294118, 0] }],
  ["orangered", { components: [1, 0.27058823529411763, 0] }],
  ["orchid", { components: [0.8549019607843137, 0.4392156862745098, 0.8392156862745098] }],
  ["peru", { components: [0.803921568627451, 0.5215686274509804, 0.24705882352941178] }],
  ["pink", { components: [1, 0.7529411764705882, 0.796078431372549] }],
  ["plum", { components: [0.8666666666666667, 0.6274509803921569, 0.8666666666666667] }],
  ["purple", { components: [0.5019607843137255, 0, 0.5019607843137255] }],
  ["red", { components: [1, 0, 0] }],
  ["salmon", { components: [0.9803921568627451, 0.5019607843137255, 0.4470588235294118] }],
  ["seagreen", { components: [0.1803921568627451, 0.5450980392156862, 0.3411764705882353] }],
  ["sienna", { components: [0.6274509803921569, 0.3215686274509804, 0.17647058823529413] }],
  ["silver", { components: [0.7529411764705882, 0.7529411764705882, 0.7529411764705882] }],
  ["skyblue", { components: [0.5294117647058824, 0.807843137254902, 0.9215686274509803] }],
  ["slategray", { components: [0.4392156862745098, 0.5019607843137255, 0.5647058823529412] }],
  ["slategrey", { components: [0.4392156862745098, 0.5019607843137255, 0.5647058823529412] }],
  ["steelblue", { components: [0.27450980392156865, 0.5098039215686275, 0.7058823529411765] }],
  ["tan", { components: [0.8235294117647058, 0.7058823529411765, 0.5490196078431373] }],
  ["teal", { components: [0, 0.5019607843137255, 0.5019607843137255] }],
  ["tomato", { components: [1, 0.38823529411764707, 0.2784313725490196] }],
  ["turquoise", { components: [0.25098039215686274, 0.8784313725490196, 0.8156862745098039] }],
  ["violet", { components: [0.9333333333333333, 0.5098039215686275, 0.9333333333333333] }],
  ["wheat", { components: [0.9607843137254902, 0.8705882352941177, 0.7019607843137254] }],
  ["white", { components: [1, 1, 1] }],
  ["yellow", { components: [1, 1, 0] }],
  ["yellowgreen", { components: [0.6039215686274509, 0.803921568627451, 0.19607843137254902] }]
]);

interface ThemeBundleExtraction {
  bundlePath: string;
  themeName: string;
  themes: StorybookExtractedTheme[];
  tokenGraph: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
  score: number;
  themeMarkers: string[];
  evidenceItems: StorybookEvidenceItem[];
  foundationPresenceByThemeId: Map<string, { hasExplicitSpacing: boolean; hasExplicitShape: boolean }>;
}

interface StoryBackfillCandidate {
  tokenClass: StorybookTokenClass;
  tokenType: StorybookTokenValueType;
  value: unknown;
  pathSuffix: string[];
}

interface StoryFieldStaticRecordResult {
  staticRecord: Record<string, StaticJsonValue> | undefined;
  conflictingKeys: string[];
  conflictingValuesByKey: Record<string, StaticJsonValue[]>;
}

const pushDiagnostic = ({
  diagnostics,
  severity,
  code,
  message,
  bundlePath,
  themeId,
  tokenPath
}: {
  diagnostics: StorybookThemeDiagnostic[];
  severity: StorybookThemeDiagnosticSeverity;
  code: string;
  message: string;
  bundlePath?: string;
  themeId?: string;
  tokenPath?: string[];
}): void => {
  diagnostics.push({
    severity,
    code,
    message,
    ...(bundlePath ? { bundlePath } : {}),
    ...(themeId ? { themeId } : {}),
    ...(tokenPath ? { tokenPath } : {})
  });
};

const collectConflictingStaticValuesByKey = ({
  records,
  conflictingKeys
}: {
  records: Array<Record<string, StaticJsonValue>>;
  conflictingKeys: string[];
}): Record<string, StaticJsonValue[]> => {
  const conflictingKeySet = new Set(conflictingKeys);
  const valuesByKey = new Map<string, StaticJsonValue[]>();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!conflictingKeySet.has(key)) {
        continue;
      }
      const existing = valuesByKey.get(key) ?? [];
      if (!existing.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
        existing.push(value);
      }
      valuesByKey.set(key, existing);
    }
  }

  return Object.fromEntries(
    [...valuesByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, values])
  );
};

const buildStableId = (prefix: string, value: unknown): string => {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
};

const normalizeNameSegment = (value: string): string => {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
};

const normalizeVariableName = (value: string): string => {
  return normalizeNameSegment(value.replace(/^--+/u, ""));
};

const resolveNormalizedBranchSegments = (keys: string[]): Map<string, string | undefined> => {
  const groupedKeys = new Map<string, string[]>();
  for (const key of keys) {
    const normalizedKey = normalizeNameSegment(key);
    const existing = groupedKeys.get(normalizedKey) ?? [];
    existing.push(key);
    groupedKeys.set(normalizedKey, existing);
  }

  const resolved = new Map<string, string | undefined>();
  for (const [normalizedKey, groupedRawKeys] of groupedKeys.entries()) {
    if (groupedRawKeys.length === 1) {
      const [onlyKey] = groupedRawKeys;
      if (!onlyKey) {
        continue;
      }
      resolved.set(onlyKey, normalizedKey);
      continue;
    }

    const canonicalKey = groupedRawKeys.find((rawKey) => rawKey === normalizedKey);
    if (canonicalKey) {
      resolved.set(canonicalKey, normalizedKey);
      for (const rawKey of groupedRawKeys) {
        if (rawKey !== canonicalKey) {
          resolved.set(rawKey, undefined);
        }
      }
      continue;
    }

    [...groupedRawKeys]
      .sort((left, right) => left.localeCompare(right))
      .forEach((rawKey, index) => {
        resolved.set(rawKey, index === 0 ? normalizedKey : `${normalizedKey}-${index + 1}`);
      });
  }

  return resolved;
};

const toPathKey = (segments: string[]): string => {
  return segments.join(".");
};

const compareBundlePaths = ({ left, right }: { left: string; right: string }): number => {
  const leftIsAsset = left.startsWith("assets/");
  const rightIsAsset = right.startsWith("assets/");
  if (leftIsAsset !== rightIsAsset) {
    return leftIsAsset ? -1 : 1;
  }
  return left.localeCompare(right);
};

const dedupeObjectArray = <T extends object>(values: T[]): T[] => {
  const byKey = new Map<string, T>();
  for (const value of values) {
    byKey.set(JSON.stringify(value), value);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
};

const mergeAliases = (
  first: StorybookTokenAliasReference[] | undefined,
  second: StorybookTokenAliasReference[] | undefined
): StorybookTokenAliasReference[] | undefined => {
  const merged = dedupeObjectArray([...(first ?? []), ...(second ?? [])]);
  return merged.length > 0 ? merged : undefined;
};

const mergeSanitizedEvidenceReferences = (
  first: StorybookSanitizedEvidenceReference[],
  second: StorybookSanitizedEvidenceReference[]
): StorybookSanitizedEvidenceReference[] => {
  return dedupeObjectArray([...first, ...second]);
};

const compareDiagnostics = (left: StorybookThemeDiagnostic, right: StorybookThemeDiagnostic): number => {
  if (left.severity !== right.severity) {
    return left.severity.localeCompare(right.severity);
  }
  if (left.code !== right.code) {
    return left.code.localeCompare(right.code);
  }
  if ((left.themeId ?? "") !== (right.themeId ?? "")) {
    return (left.themeId ?? "").localeCompare(right.themeId ?? "");
  }
  if ((left.bundlePath ?? "") !== (right.bundlePath ?? "")) {
    return (left.bundlePath ?? "").localeCompare(right.bundlePath ?? "");
  }
  if (toPathKey(left.tokenPath ?? []) !== toPathKey(right.tokenPath ?? [])) {
    return toPathKey(left.tokenPath ?? []).localeCompare(toPathKey(right.tokenPath ?? []));
  }
  return left.message.localeCompare(right.message);
};

const compareThemes = (left: StorybookExtractedTheme, right: StorybookExtractedTheme): number => {
  if (left.context !== right.context) {
    return left.context.localeCompare(right.context);
  }
  if (left.id !== right.id) {
    return left.id.localeCompare(right.id);
  }
  return left.name.localeCompare(right.name);
};

const compareThemeExtractions = (left: ThemeBundleExtraction, right: ThemeBundleExtraction): number => {
  const leftErrorCount = left.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const rightErrorCount = right.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  if (leftErrorCount !== rightErrorCount) {
    return leftErrorCount - rightErrorCount;
  }

  const leftBaseName = path.posix.basename(normalizePosixPath(left.bundlePath)).toLowerCase();
  const rightBaseName = path.posix.basename(normalizePosixPath(right.bundlePath)).toLowerCase();
  const leftIsIframeBundle = leftBaseName.startsWith("iframe");
  const rightIsIframeBundle = rightBaseName.startsWith("iframe");
  if (leftIsIframeBundle !== rightIsIframeBundle) {
    return leftIsIframeBundle ? -1 : 1;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.themeMarkers.length !== left.themeMarkers.length) {
    return right.themeMarkers.length - left.themeMarkers.length;
  }

  return compareBundlePaths({ left: left.bundlePath, right: right.bundlePath });
};

const collectBalancedObjectSegments = (source: string): string[] => {
  const segments: string[] = [];
  const stack: number[] = [];

  const isEscaped = (index: number): boolean => {
    let slashCount = 0;
    let cursor = index - 1;
    while (cursor >= 0 && source[cursor] === "\\") {
      slashCount += 1;
      cursor -= 1;
    }
    return slashCount % 2 === 1;
  };

  const skipString = (startIndex: number): number => {
    const quote = source[startIndex];
    let cursor = startIndex + 1;
    while (cursor < source.length) {
      const current = source[cursor];
      if (quote === "`" && current === "$" && source[cursor + 1] === "{") {
        let braceDepth = 1;
        cursor += 2;
        while (cursor < source.length && braceDepth > 0) {
          if (source[cursor] === "\"" || source[cursor] === "'" || source[cursor] === "`") {
            cursor = skipString(cursor);
            continue;
          }
          if (source[cursor] === "{") {
            braceDepth += 1;
          } else if (source[cursor] === "}") {
            braceDepth -= 1;
          }
          cursor += 1;
        }
        continue;
      }
      if (current === quote && !isEscaped(cursor)) {
        return cursor + 1;
      }
      cursor += 1;
    }
    return source.length;
  };

  const skipLineComment = (startIndex: number): number => {
    let cursor = startIndex + 2;
    while (cursor < source.length && source[cursor] !== "\n") {
      cursor += 1;
    }
    return cursor;
  };

  const skipBlockComment = (startIndex: number): number => {
    const endIndex = source.indexOf("*/", startIndex + 2);
    return endIndex === -1 ? source.length : endIndex + 2;
  };

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const current = source[cursor];
    if (current === "\"" || current === "'" || current === "`") {
      cursor = skipString(cursor) - 1;
      continue;
    }
    if (current === "/" && source[cursor + 1] === "/") {
      cursor = skipLineComment(cursor) - 1;
      continue;
    }
    if (current === "/" && source[cursor + 1] === "*") {
      cursor = skipBlockComment(cursor) - 1;
      continue;
    }
    if (current === "{") {
      stack.push(cursor);
      continue;
    }
    if (current === "}" && stack.length > 0) {
      const startIndex = stack.pop() ?? 0;
      segments.push(source.slice(startIndex, cursor + 1));
    }
  }

  return segments;
};

const scoreThemeCandidate = ({
  objectText,
  topLevelKeys
}: {
  objectText: string;
  topLevelKeys: string[];
}): number => {
  const keySet = new Set(topLevelKeys);
  if (
    !keySet.has("palette") &&
    !keySet.has("colorSchemes") &&
    !keySet.has("components") &&
    !keySet.has("typography") &&
    !keySet.has("shape") &&
    !keySet.has("spacing") &&
    !keySet.has("zIndex")
  ) {
    return 0;
  }

  let score = 0;
  for (const key of topLevelKeys) {
    if (key === "palette" || key === "colorSchemes") {
      score += 8;
      continue;
    }
    if (key === "typography" || key === "spacing" || key === "components" || key === "shape" || key === "zIndex") {
      score += 4;
      continue;
    }
    if (STRONG_THEME_KEYS.has(key)) {
      score += 2;
    }
  }

  if (objectText.includes("MuiCssBaseline")) {
    score += 4;
  }
  if (objectText.includes("\"@font-face\"") || objectText.includes("'@font-face'")) {
    score += 4;
  }
  if (objectText.includes("fontFamily")) {
    score += 2;
  }
  if (objectText.includes("createTheme") || objectText.includes("extendTheme")) {
    score += 2;
  }

  return score;
};

const collectMuiThemeCandidates = ({
  bundlePath,
  bundleText
}: {
  bundlePath: string;
  bundleText: string;
}): StorybookThemeCandidate[] => {
  return collectBalancedObjectSegments(bundleText)
    .map((objectText) => {
      const topLevelKeys = extractTopLevelObjectKeys(objectText);
      return {
        id: buildStableId("theme-candidate", { bundlePath, objectText }),
        bundlePath,
        topLevelKeys,
        objectText,
        score: scoreThemeCandidate({ objectText, topLevelKeys })
      } satisfies StorybookThemeCandidate;
    })
    .filter((candidate) => candidate.score >= 8)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.objectText.length - left.objectText.length;
    });
};

const getObjectProperty = (value: JsStaticValue, key: string): JsStaticValue | undefined => {
  if (!isJsStaticObjectValue(value)) {
    return undefined;
  }
  return value.properties.get(key);
};

const getStringProperty = (value: JsStaticValue, key: string): string | undefined => {
  const property = getObjectProperty(value, key);
  return property && isJsStaticStringValue(property) ? property.value : undefined;
};

const getNumberProperty = (value: JsStaticValue, key: string): number | undefined => {
  const property = getObjectProperty(value, key);
  return property && isJsStaticNumberValue(property) ? property.value : undefined;
};

const isStaticJsonRecord = (value: StaticJsonValue | undefined): value is Record<string, StaticJsonValue> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseHexColor = (value: string): { colorSpace: "srgb"; components: [number, number, number]; alpha?: number } | undefined => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/u);
  if (!match?.[1]) {
    return undefined;
  }
  const hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    const red = parseInt(`${hex[0]}${hex[0]}`, 16) / 255;
    const green = parseInt(`${hex[1]}${hex[1]}`, 16) / 255;
    const blue = parseInt(`${hex[2]}${hex[2]}`, 16) / 255;
    const alpha = hex.length === 4 ? parseInt(`${hex[3]}${hex[3]}`, 16) / 255 : undefined;
    return {
      colorSpace: "srgb",
      components: [red, green, blue],
      ...(alpha !== undefined ? { alpha } : {})
    };
  }

  const red = parseInt(hex.slice(0, 2), 16) / 255;
  const green = parseInt(hex.slice(2, 4), 16) / 255;
  const blue = parseInt(hex.slice(4, 6), 16) / 255;
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : undefined;
  return {
    colorSpace: "srgb",
    components: [red, green, blue],
    ...(alpha !== undefined ? { alpha } : {})
  };
};

const parseRgbColor = (value: string): { colorSpace: "srgb"; components: [number, number, number]; alpha?: number } | undefined => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^rgba?\(([^)]+)\)$/u);
  if (!match?.[1]) {
    return undefined;
  }
  const inner = match[1].trim();

  let rgbParts: string[];
  let alphaRaw: string | undefined;

  if (inner.includes(",")) {
    const parts = inner.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) {
      return undefined;
    }
    rgbParts = parts.slice(0, 3);
    alphaRaw = parts[3];
  } else {
    const slashIndex = inner.indexOf("/");
    const colorPart = slashIndex === -1 ? inner : inner.slice(0, slashIndex);
    alphaRaw = slashIndex === -1 ? undefined : inner.slice(slashIndex + 1).trim();
    rgbParts = colorPart.trim().split(/\s+/u);
    if (rgbParts.length !== 3) {
      return undefined;
    }
  }

  const components = rgbParts.map((part) => Number(part) / 255);
  if (components.some((component) => Number.isNaN(component))) {
    return undefined;
  }
  const alpha = alphaRaw === undefined ? undefined : Number(alphaRaw);
  return {
    colorSpace: "srgb",
    components: [components[0] ?? 0, components[1] ?? 0, components[2] ?? 0],
    ...(alpha !== undefined && !Number.isNaN(alpha) ? { alpha } : {})
  };
};

const parseNamedCssColor = (value: string): { colorSpace: "srgb"; components: [number, number, number]; alpha?: number } | undefined => {
  const entry = NAMED_CSS_COLORS.get(value.trim().toLowerCase());
  if (!entry) {
    return undefined;
  }
  return {
    colorSpace: "srgb",
    components: entry.components,
    ...(entry.alpha !== undefined ? { alpha: entry.alpha } : {})
  };
};

const parseHslColor = (value: string): { colorSpace: "srgb"; components: [number, number, number]; alpha?: number } | undefined => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^hsla?\(([^)]+)\)$/u);
  if (!match?.[1]) {
    return undefined;
  }
  const inner = match[1].trim();

  let huePart: string;
  let satPart: string;
  let lightPart: string;
  let alphaRaw: string | undefined;

  if (inner.includes(",")) {
    const parts = inner.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) {
      return undefined;
    }
    huePart = parts[0] ?? "";
    satPart = parts[1] ?? "";
    lightPart = parts[2] ?? "";
    alphaRaw = parts[3];
  } else {
    const slashIndex = inner.indexOf("/");
    const colorPart = slashIndex === -1 ? inner : inner.slice(0, slashIndex);
    alphaRaw = slashIndex === -1 ? undefined : inner.slice(slashIndex + 1).trim();
    const spaceParts = colorPart.trim().split(/\s+/u);
    if (spaceParts.length !== 3) {
      return undefined;
    }
    huePart = spaceParts[0] ?? "";
    satPart = spaceParts[1] ?? "";
    lightPart = spaceParts[2] ?? "";
  }

  const hue = (((Number(huePart.replace(/deg$/u, "")) % 360) + 360) % 360) / 360;
  const saturation = Number(satPart.replace(/%$/u, "")) / 100;
  const lightness = Number(lightPart.replace(/%$/u, "")) / 100;

  if ([hue, saturation, lightness].some((v) => Number.isNaN(v))) {
    return undefined;
  }

  const hueToRgb = (p: number, q: number, t: number): number => {
    const adjusted = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
    if (adjusted < 1 / 2) return q;
    if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
    return p;
  };

  let red: number;
  let green: number;
  let blue: number;

  if (saturation === 0) {
    red = green = blue = lightness;
  } else {
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    red = hueToRgb(p, q, hue + 1 / 3);
    green = hueToRgb(p, q, hue);
    blue = hueToRgb(p, q, hue - 1 / 3);
  }

  const alpha = alphaRaw === undefined ? undefined : Number(alphaRaw.replace(/%$/u, "")) / (alphaRaw.endsWith("%") ? 100 : 1);

  return {
    colorSpace: "srgb",
    components: [red, green, blue],
    ...(alpha !== undefined && !Number.isNaN(alpha) ? { alpha } : {})
  };
};

const toColorTokenValue = (value: string): unknown => {
  return parseHexColor(value) ?? parseRgbColor(value) ?? parseHslColor(value) ?? parseNamedCssColor(value);
};

const parseDimensionString = (value: string): { value: number; unit: string } | undefined => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em)$/u);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const numericValue = Number(match[1]);
  if (Number.isNaN(numericValue)) {
    return undefined;
  }
  return {
    value: numericValue,
    unit: match[2]
  };
};

const parsePlainNumberString = (value: string): number | undefined => {
  const normalized = value.trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(normalized)) {
    return undefined;
  }
  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : undefined;
};

const parseDimensionValue = (value: number | string): { value: number; unit: string } | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, unit: "px" };
  }
  return parseDimensionString(String(value));
};

const parseFontFamily = (value: string): string | string[] => {
  const parts = value
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/gu, ""))
    .filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return parts[0] ?? value.trim();
  }
  return parts;
};

const toComparableTokenValue = (tokenValue: unknown): string | undefined => {
  if (typeof tokenValue === "string") {
    return tokenValue.trim().toLowerCase();
  }
  if (typeof tokenValue === "number") {
    return String(tokenValue);
  }
  if (
    typeof tokenValue === "object" &&
    tokenValue !== null &&
    "value" in tokenValue &&
    "unit" in tokenValue &&
    typeof (tokenValue as { value?: unknown }).value === "number" &&
    typeof (tokenValue as { unit?: unknown }).unit === "string"
  ) {
    const dimension = tokenValue as { value: number; unit: string };
    return `${dimension.value}${dimension.unit}`.toLowerCase();
  }
  if (
    typeof tokenValue === "object" &&
    tokenValue !== null &&
    "colorSpace" in tokenValue &&
    "components" in tokenValue &&
    (tokenValue as { colorSpace?: unknown }).colorSpace === "srgb" &&
    Array.isArray((tokenValue as { components?: unknown }).components)
  ) {
    const color = tokenValue as {
      colorSpace: string;
      components: number[];
      alpha?: number;
    };
    return JSON.stringify({
      colorSpace: color.colorSpace,
      components: color.components.map((component) => Number(component.toFixed(6))),
      ...(color.alpha !== undefined ? { alpha: Number(color.alpha.toFixed(6)) } : {})
    });
  }
  return undefined;
};

const toSanitizedEvidenceReference = (evidenceItem: StorybookEvidenceItem): StorybookSanitizedEvidenceReference => {
  return {
    type: evidenceItem.type,
    reliability: evidenceItem.reliability,
    ...(evidenceItem.source.entryId ? { entryId: evidenceItem.source.entryId } : {}),
    ...(evidenceItem.source.entryIds && evidenceItem.source.entryIds.length > 0
      ? { entryIds: uniqueSorted(evidenceItem.source.entryIds) }
      : {}),
    ...(evidenceItem.source.entryType ? { entryType: evidenceItem.source.entryType } : {}),
    ...(evidenceItem.source.title ? { title: evidenceItem.source.title } : {}),
    ...(evidenceItem.summary.keys && evidenceItem.summary.keys.length > 0
      ? { keys: uniqueSorted(evidenceItem.summary.keys) }
      : {}),
    ...(evidenceItem.summary.themeMarkers && evidenceItem.summary.themeMarkers.length > 0
      ? { themeMarkers: uniqueSorted(evidenceItem.summary.themeMarkers) }
      : {}),
    ...(evidenceItem.summary.customProperties && evidenceItem.summary.customProperties.length > 0
      ? { customProperties: uniqueSorted(evidenceItem.summary.customProperties) }
      : {})
  };
};

const createTokenEntry = ({
  themeId,
  path: tokenPath,
  tokenClass,
  tokenType,
  value,
  evidenceItems,
  isBackfilled,
  aliases,
  cssVariableNames,
  description
}: {
  themeId: string;
  path: string[];
  tokenClass: StorybookTokenClass;
  tokenType: StorybookTokenValueType;
  value: unknown;
  evidenceItems: StorybookEvidenceItem[];
  isBackfilled: boolean;
  aliases?: StorybookTokenAliasReference[];
  cssVariableNames?: string[];
  description?: string;
}): StorybookTokenGraphEntry => {
  return {
    id: buildStableId("theme-token", {
      path: tokenPath,
      tokenType,
      value
    }),
    themeId,
    path: tokenPath,
    tokenClass,
    tokenType,
    value,
    provenance: dedupeObjectArray(evidenceItems.map(toSanitizedEvidenceReference)),
    completeness: {
      isBackfilled,
      satisfiesRequiredClass: REQUIRED_THEME_CATEGORIES.has(tokenClass) || tokenClass === "font" || tokenClass === "typography"
    },
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    ...(cssVariableNames && cssVariableNames.length > 0 ? { cssVariableNames: uniqueSorted(cssVariableNames) } : {}),
    ...(description ? { description } : {})
  };
};

const mergeTokenEntry = ({
  tokenGraphByPath,
  entry,
  diagnostics
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  entry: StorybookTokenGraphEntry;
  diagnostics: StorybookThemeDiagnostic[];
}): void => {
  const key = toPathKey(entry.path);
  const existing = tokenGraphByPath.get(key);
  if (!existing) {
    tokenGraphByPath.set(key, entry);
    return;
  }

  const isSameValue =
    existing.tokenType === entry.tokenType &&
    existing.tokenClass === entry.tokenClass &&
    JSON.stringify(existing.value) === JSON.stringify(entry.value);
  if (!isSameValue) {
    if (existing.completeness.isBackfilled && !entry.completeness.isBackfilled) {
      tokenGraphByPath.set(key, entry);
      return;
    }
    if (!existing.completeness.isBackfilled && entry.completeness.isBackfilled) {
      return;
    }
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "STORYBOOK_TOKEN_CONFLICT",
      message: `Token path '${key}' resolves to conflicting authoritative values.`,
      themeId: entry.themeId,
      tokenPath: entry.path
    });
    return;
  }

  existing.provenance = mergeSanitizedEvidenceReferences(existing.provenance, entry.provenance);
  const mergedAliases = mergeAliases(existing.aliases, entry.aliases);
  if (mergedAliases) {
    existing.aliases = mergedAliases;
  } else {
    delete existing.aliases;
  }
  existing.cssVariableNames = uniqueSorted([...(existing.cssVariableNames ?? []), ...(entry.cssVariableNames ?? [])]);
  existing.completeness = {
    isBackfilled: existing.completeness.isBackfilled && entry.completeness.isBackfilled,
    satisfiesRequiredClass:
      existing.completeness.satisfiesRequiredClass || entry.completeness.satisfiesRequiredClass
  };
};

const isSameTokenValue = (left: StorybookTokenGraphEntry, right: StorybookTokenGraphEntry): boolean => {
  return (
    left.tokenType === right.tokenType &&
    left.tokenClass === right.tokenClass &&
    JSON.stringify(left.value) === JSON.stringify(right.value)
  );
};

const findDuplicateThemeBundleConflicts = ({
  extraction,
  existingThemesById,
  tokenGraphByPath
}: {
  extraction: ThemeBundleExtraction;
  existingThemesById: Map<string, StorybookExtractedTheme>;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
}): {
  duplicateThemeIds: string[];
  conflictingTokenPaths: string[];
  hasDuplicateThemeErrors: boolean;
} => {
  const duplicateThemeIds = extraction.themes
    .map((theme) => theme.id)
    .filter((themeId, index, ids) => existingThemesById.has(themeId) && ids.indexOf(themeId) === index)
    .sort((left, right) => left.localeCompare(right));

  if (duplicateThemeIds.length === 0) {
    return {
      duplicateThemeIds,
      conflictingTokenPaths: [],
      hasDuplicateThemeErrors: false
    };
  }

  const duplicateThemeIdSet = new Set(duplicateThemeIds);
  const conflictingTokenPaths = extraction.tokenGraph
    .filter((token) => duplicateThemeIdSet.has(token.themeId))
    .flatMap((token) => {
      const existing = tokenGraphByPath.get(toPathKey(token.path));
      if (!existing || isSameTokenValue(existing, token)) {
        return [];
      }
      return [toPathKey(token.path)];
    })
    .sort((left, right) => left.localeCompare(right));

  const hasDuplicateThemeErrors = extraction.diagnostics.some((diagnostic) => {
    if (diagnostic.severity !== "error") {
      return false;
    }
    if (!diagnostic.themeId) {
      return true;
    }
    return duplicateThemeIdSet.has(diagnostic.themeId);
  });

  return {
    duplicateThemeIds,
    conflictingTokenPaths,
    hasDuplicateThemeErrors
  };
};

const addTokenEntry = ({
  tokenGraphByPath,
  themeId,
  path: tokenPath,
  tokenClass,
  tokenType,
  value,
  evidenceItems,
  diagnostics,
  isBackfilled,
  aliases,
  cssVariableNames,
  description
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  themeId: string;
  path: string[];
  tokenClass: StorybookTokenClass;
  tokenType: StorybookTokenValueType;
  value: unknown;
  evidenceItems: StorybookEvidenceItem[];
  diagnostics: StorybookThemeDiagnostic[];
  isBackfilled: boolean;
  aliases?: StorybookTokenAliasReference[];
  cssVariableNames?: string[];
  description?: string;
}): void => {
  mergeTokenEntry({
    tokenGraphByPath,
    diagnostics,
    entry: createTokenEntry({
      themeId,
      path: tokenPath,
      tokenClass,
      tokenType,
      value,
      evidenceItems,
      isBackfilled,
      ...(aliases ? { aliases } : {}),
      ...(cssVariableNames ? { cssVariableNames } : {}),
      ...(description ? { description } : {})
    })
  });
};

const ensureGlobalFontToken = ({
  tokenGraphByPath,
  diagnostics,
  themeId,
  path: tokenPath,
  tokenType,
  value,
  evidenceItems
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  themeId: string;
  path: string[];
  tokenType: "fontFamily" | "fontWeight";
  value: string | number;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookTokenAliasReference => {
  addTokenEntry({
    tokenGraphByPath,
    themeId,
    path: tokenPath,
    tokenClass: "font",
    tokenType,
    value,
    evidenceItems,
    diagnostics,
    isBackfilled: false
  });
  return { path: tokenPath };
};

const addThemeFontAliasToken = ({
  tokenGraphByPath,
  diagnostics,
  themeId,
  tokenPath,
  tokenType,
  aliasPath,
  evidenceItems,
  description
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  themeId: string;
  tokenPath: string[];
  tokenType: "fontFamily" | "fontWeight";
  aliasPath: string[];
  evidenceItems: StorybookEvidenceItem[];
  description?: string;
}): void => {
  addTokenEntry({
    tokenGraphByPath,
    themeId,
    path: tokenPath,
    tokenClass: "font",
    tokenType,
    value: `{${toPathKey(aliasPath)}}`,
    evidenceItems,
    diagnostics,
    isBackfilled: false,
    ...(description ? { description } : {})
  });
};

const addFontFamilyToken = ({
  tokenGraphByPath,
  diagnostics,
  themeId,
  familyName,
  evidenceItems
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  themeId: string;
  familyName: string;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookTokenAliasReference => {
  const normalizedFamily = normalizeNameSegment(familyName);
  const globalPath = [FONT_CONTEXT_PREFIX, "family", normalizedFamily];
  const globalAlias = ensureGlobalFontToken({
    tokenGraphByPath,
    diagnostics,
    themeId,
    path: globalPath,
    tokenType: "fontFamily",
    value: familyName,
    evidenceItems
  });
  addThemeFontAliasToken({
    tokenGraphByPath,
    diagnostics,
    themeId,
    tokenPath: [THEME_CONTEXT_PREFIX, themeId, "font", "family", normalizedFamily],
    tokenType: "fontFamily",
    aliasPath: globalAlias.path,
    evidenceItems
  });
  return globalAlias;
};

const addFontWeightToken = ({
  tokenGraphByPath,
  diagnostics,
  themeId,
  weight,
  evidenceItems
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  themeId: string;
  weight: number | string;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookTokenAliasReference => {
  const normalizedWeight = normalizeNameSegment(String(weight));
  const globalPath = [FONT_CONTEXT_PREFIX, "weight", normalizedWeight];
  const globalAlias = ensureGlobalFontToken({
    tokenGraphByPath,
    diagnostics,
    themeId,
    path: globalPath,
    tokenType: "fontWeight",
    value: weight,
    evidenceItems
  });
  addThemeFontAliasToken({
    tokenGraphByPath,
    diagnostics,
    themeId,
    tokenPath: [THEME_CONTEXT_PREFIX, themeId, "font", "weight", normalizedWeight],
    tokenType: "fontWeight",
    aliasPath: globalAlias.path,
    evidenceItems
  });
  return globalAlias;
};

const collectFontFaceObjects = (value: JsStaticValue): Array<Map<string, JsStaticValue>> => {
  const results: Array<Map<string, JsStaticValue>> = [];
  if (isJsStaticObjectValue(value)) {
    const fontFaceValue = value.properties.get("@font-face");
    if (fontFaceValue && isJsStaticArrayValue(fontFaceValue)) {
      for (const entry of fontFaceValue.values) {
        if (isJsStaticObjectValue(entry)) {
          results.push(entry.properties);
        }
      }
    }

    for (const nestedValue of value.properties.values()) {
      results.push(...collectFontFaceObjects(nestedValue));
    }
  } else if (isJsStaticArrayValue(value)) {
    for (const nestedValue of value.values) {
      results.push(...collectFontFaceObjects(nestedValue));
    }
  }
  return results;
};

const isSpacingPropertyKey = (key: string): boolean => {
  return SPACING_PROPERTY_KEYS.has(key) || key.startsWith("padding") || key.startsWith("margin");
};

const isDimensionPropertyKey = (key: string): boolean => {
  return DIMENSION_PROPERTY_KEYS.has(key) || key.startsWith("min") || key.startsWith("max");
};

const buildTypographyCompositeValue = ({
  variantValue,
  defaultFontFamilyAlias,
  defaultFontWeightAlias
}: {
  variantValue: JsStaticValue;
  defaultFontFamilyAlias?: StorybookTokenAliasReference;
  defaultFontWeightAlias?: StorybookTokenAliasReference;
}): unknown => {
  if (!isJsStaticObjectValue(variantValue)) {
    return undefined;
  }

  const fontFamily = getStringProperty(variantValue, "fontFamily");
  const fontSizeNumber = getNumberProperty(variantValue, "fontSize");
  const fontSizeString = getStringProperty(variantValue, "fontSize");
  const fontWeightNumber = getNumberProperty(variantValue, "fontWeight");
  const fontWeightString = getStringProperty(variantValue, "fontWeight");
  const lineHeightNumber = getNumberProperty(variantValue, "lineHeight");
  const letterSpacingNumber = getNumberProperty(variantValue, "letterSpacing");
  const textTransform = getStringProperty(variantValue, "textTransform");

  const composite: Record<string, unknown> = {};
  if (fontFamily) {
    composite.fontFamily = parseFontFamily(fontFamily);
  } else if (defaultFontFamilyAlias) {
    composite.fontFamily = `{${toPathKey(defaultFontFamilyAlias.path)}}`;
  }
  if (fontSizeNumber !== undefined) {
    composite.fontSize = { value: fontSizeNumber, unit: "px" };
  } else if (fontSizeString) {
    const fontSizeDimension = parseDimensionString(fontSizeString);
    if (fontSizeDimension) {
      composite.fontSize = fontSizeDimension;
    }
  }
  if (fontWeightNumber !== undefined) {
    composite.fontWeight = fontWeightNumber;
  } else if (fontWeightString) {
    composite.fontWeight = fontWeightString;
  } else if (defaultFontWeightAlias) {
    composite.fontWeight = `{${toPathKey(defaultFontWeightAlias.path)}}`;
  }
  if (lineHeightNumber !== undefined) {
    composite.lineHeight = lineHeightNumber;
  }
  if (letterSpacingNumber !== undefined) {
    composite.letterSpacing = letterSpacingNumber;
  }
  if (textTransform) {
    composite.textTransform = textTransform;
  }

  return Object.keys(composite).length > 0 ? composite : undefined;
};

const buildTypographyCompositeFromStaticJson = ({
  value,
  defaultFontFamilyAlias,
  defaultFontWeightAlias
}: {
  value: StaticJsonValue;
  defaultFontFamilyAlias?: StorybookTokenAliasReference;
  defaultFontWeightAlias?: StorybookTokenAliasReference;
}): unknown => {
  if (!isStaticJsonRecord(value)) {
    return undefined;
  }

  const fontFamily = typeof value.fontFamily === "string" ? value.fontFamily : undefined;
  const fontSize = typeof value.fontSize === "number" || typeof value.fontSize === "string" ? value.fontSize : undefined;
  const fontWeight =
    typeof value.fontWeight === "number" || typeof value.fontWeight === "string" ? value.fontWeight : undefined;
  const lineHeight = typeof value.lineHeight === "number" ? value.lineHeight : undefined;
  const letterSpacing = typeof value.letterSpacing === "number" ? value.letterSpacing : undefined;
  const textTransform = typeof value.textTransform === "string" ? value.textTransform : undefined;

  const composite: Record<string, unknown> = {};
  if (fontFamily) {
    composite.fontFamily = parseFontFamily(fontFamily);
  } else if (defaultFontFamilyAlias) {
    composite.fontFamily = `{${toPathKey(defaultFontFamilyAlias.path)}}`;
  }
  if (typeof fontSize === "number") {
    composite.fontSize = { value: fontSize, unit: "px" };
  } else if (typeof fontSize === "string") {
    const fontSizeDimension = parseDimensionString(fontSize);
    if (fontSizeDimension) {
      composite.fontSize = fontSizeDimension;
    }
  }
  if (fontWeight !== undefined) {
    composite.fontWeight = fontWeight;
  } else if (defaultFontWeightAlias) {
    composite.fontWeight = `{${toPathKey(defaultFontWeightAlias.path)}}`;
  }
  if (lineHeight !== undefined) {
    composite.lineHeight = lineHeight;
  }
  if (letterSpacing !== undefined) {
    composite.letterSpacing = letterSpacing;
  }
  if (textTransform) {
    composite.textTransform = textTransform;
  }

  return Object.keys(composite).length > 0 ? composite : undefined;
};

const hasTypographyFieldsInStaticJson = (value: StaticJsonValue | undefined): boolean => {
  if (!isStaticJsonRecord(value)) {
    return false;
  }
  return [...TYPOGRAPHY_PROPERTY_KEYS].some((key) => key in value);
};

const extractPaletteTokens = ({
  paletteValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  paletteValue: JsStaticValue;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!isJsStaticObjectValue(paletteValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_PALETTE_UNRESOLVED",
      message: `Theme '${themeId}' contains a palette surface that is not statically evaluable.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "color"]
    });
    return 0;
  }

  let extractedCount = 0;
  const visitPaletteBranch = ({
    value,
    pathSegments
  }: {
    value: JsStaticValue;
    pathSegments: string[];
  }): void => {
    if (!isJsStaticObjectValue(value)) {
      return;
    }
    const normalizedSegmentsByKey = resolveNormalizedBranchSegments([...value.properties.keys()]);
    for (const [key, nestedValue] of value.properties.entries()) {
      const normalizedKey = normalizedSegmentsByKey.get(key);
      if (!normalizedKey) {
        continue;
      }
      if (isJsStaticStringValue(nestedValue)) {
        const tokenValue = toColorTokenValue(nestedValue.value);
        if (!tokenValue) {
          continue;
        }
        extractedCount += 1;
        addTokenEntry({
          tokenGraphByPath,
          themeId,
          path: [THEME_CONTEXT_PREFIX, themeId, "color", ...pathSegments, normalizedKey],
          tokenClass: "color",
          tokenType: "color",
          value: tokenValue,
          evidenceItems,
          diagnostics,
          isBackfilled: false
        });
        continue;
      }
      if (isJsStaticObjectValue(nestedValue)) {
        visitPaletteBranch({
          value: nestedValue,
          pathSegments: [...pathSegments, normalizedKey]
        });
      }
    }
  };

  visitPaletteBranch({
    value: paletteValue,
    pathSegments: []
  });

  return extractedCount;
};

const extractSpacingTokens = ({
  spacingValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  spacingValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!spacingValue) {
    return 0;
  }

  if (isJsStaticNumberValue(spacingValue)) {
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "base"],
      tokenClass: "spacing",
      tokenType: "dimension",
      value: { value: spacingValue.value, unit: "px" },
      evidenceItems,
      diagnostics,
      isBackfilled: false
    });
    return 1;
  }

  if (isJsStaticStringValue(spacingValue)) {
    const dimension = parseDimensionString(spacingValue.value);
    if (!dimension) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_SPACING_DYNAMIC_UNSUPPORTED",
        message: `Theme '${themeId}' uses a spacing surface that is not statically evaluable.`,
        bundlePath,
        themeId,
        tokenPath: [THEME_CONTEXT_PREFIX, themeId, "spacing"]
      });
      return 0;
    }
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "base"],
      tokenClass: "spacing",
      tokenType: "dimension",
      value: dimension,
      evidenceItems,
      diagnostics,
      isBackfilled: false
    });
    return 1;
  }

  if (isJsStaticArrayValue(spacingValue)) {
    let extractedCount = 0;
    spacingValue.values.forEach((entry, index) => {
      const dimension =
        isJsStaticNumberValue(entry)
          ? { value: entry.value, unit: "px" }
          : isJsStaticStringValue(entry)
            ? parseDimensionString(entry.value)
            : undefined;
      if (!dimension) {
        return;
      }
      extractedCount += 1;
      addTokenEntry({
        tokenGraphByPath,
        themeId,
        path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "scale", String(index)],
        tokenClass: "spacing",
        tokenType: "dimension",
        value: dimension,
        evidenceItems,
        diagnostics,
        isBackfilled: false
      });
    });
    return extractedCount;
  }

  pushDiagnostic({
    diagnostics,
    severity: "error",
    code: "MUI_THEME_SPACING_DYNAMIC_UNSUPPORTED",
    message: `Theme '${themeId}' uses a spacing surface that is not statically evaluable.`,
    bundlePath,
    themeId,
    tokenPath: [THEME_CONTEXT_PREFIX, themeId, "spacing"]
  });
  return 0;
};

const extractTypographyTokens = ({
  typographyValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  typographyValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!typographyValue) {
    return 0;
  }
  if (!isJsStaticObjectValue(typographyValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_TYPOGRAPHY_UNRESOLVED",
      message: `Theme '${themeId}' exposes a typography surface that is not statically evaluable.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "typography"]
    });
    return 0;
  }

  const defaultFamilyName = getStringProperty(typographyValue, "fontFamily");
  const defaultFamilyAlias =
    defaultFamilyName && defaultFamilyName.trim().length > 0
      ? addFontFamilyToken({
          tokenGraphByPath,
          diagnostics,
          themeId,
          familyName: Array.isArray(parseFontFamily(defaultFamilyName))
            ? (parseFontFamily(defaultFamilyName) as string[])[0] ?? defaultFamilyName
            : (parseFontFamily(defaultFamilyName) as string),
          evidenceItems
        })
      : undefined;
  const defaultWeightValue = getNumberProperty(typographyValue, "fontWeightRegular");
  const defaultWeightAlias =
    defaultWeightValue !== undefined
      ? addFontWeightToken({
          tokenGraphByPath,
          diagnostics,
          themeId,
          weight: defaultWeightValue,
          evidenceItems
        })
      : undefined;

  let extractedCount = 0;
  const baseComposite = buildTypographyCompositeValue({
    variantValue: typographyValue,
    ...(defaultFamilyAlias ? { defaultFontFamilyAlias: defaultFamilyAlias } : {}),
    ...(defaultWeightAlias ? { defaultFontWeightAlias: defaultWeightAlias } : {})
  });
  if (baseComposite) {
    extractedCount += 1;
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "typography", "base"],
      tokenClass: "typography",
      tokenType: "typography",
      value: baseComposite,
      evidenceItems,
      diagnostics,
      isBackfilled: false
    });
  }

  for (const [variantName, variantValue] of typographyValue.properties.entries()) {
    if (!isJsStaticObjectValue(variantValue)) {
      continue;
    }
    const composite = buildTypographyCompositeValue({
      variantValue,
      ...(defaultFamilyAlias ? { defaultFontFamilyAlias: defaultFamilyAlias } : {}),
      ...(defaultWeightAlias ? { defaultFontWeightAlias: defaultWeightAlias } : {})
    });
    if (!composite) {
      continue;
    }
    extractedCount += 1;
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "typography", normalizeNameSegment(variantName)],
      tokenClass: "typography",
      tokenType: "typography",
      value: composite,
      evidenceItems,
      diagnostics,
      isBackfilled: false
    });
  }

  if (extractedCount === 0) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_TYPOGRAPHY_UNRESOLVED",
      message: `Theme '${themeId}' exposes a typography surface without extractable static tokens.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "typography"]
    });
  }

  return extractedCount;
};

const extractFontFaceTokens = ({
  componentsValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  componentsValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!componentsValue || !isJsStaticObjectValue(componentsValue)) {
    return 0;
  }
  const muiCssBaseline = componentsValue.properties.get("MuiCssBaseline");
  if (!muiCssBaseline || !isJsStaticObjectValue(muiCssBaseline)) {
    return 0;
  }
  const styleOverrides = muiCssBaseline.properties.get("styleOverrides");
  if (!styleOverrides) {
    return 0;
  }

  const fontFaces = collectFontFaceObjects(styleOverrides);
  let extractedCount = 0;
  for (const fontFace of fontFaces) {
    const fontFamilyValue = fontFace.get("fontFamily");
    const fontWeightValue = fontFace.get("fontWeight");

    if (fontFamilyValue && isJsStaticStringValue(fontFamilyValue)) {
      extractedCount += 1;
      addFontFamilyToken({
        tokenGraphByPath,
        diagnostics,
        themeId,
        familyName: fontFamilyValue.value,
        evidenceItems
      });
    }

    if (fontWeightValue && (isJsStaticNumberValue(fontWeightValue) || isJsStaticStringValue(fontWeightValue))) {
      extractedCount += 1;
      addFontWeightToken({
        tokenGraphByPath,
        diagnostics,
        themeId,
        weight: fontWeightValue.value,
        evidenceItems
      });
    }
  }

  if (fontFaces.length > 0 && extractedCount === 0) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_FONT_FACE_UNRESOLVED",
      message: `Theme '${themeId}' exposes static font-face surfaces without extractable font tokens.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "font"]
    });
  }

  return extractedCount;
};

const extractRadiusTokens = ({
  shapeValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  shapeValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!shapeValue) {
    return 0;
  }
  if (!isJsStaticObjectValue(shapeValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_RADIUS_UNRESOLVED",
      message: `Theme '${themeId}' exposes a shape surface that is not statically evaluable.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "radius"]
    });
    return 0;
  }

  const borderRadiusNumber = getNumberProperty(shapeValue, "borderRadius");
  const borderRadiusString = getStringProperty(shapeValue, "borderRadius");
  const dimension =
    borderRadiusNumber !== undefined
      ? { value: borderRadiusNumber, unit: "px" }
      : borderRadiusString
        ? parseDimensionString(borderRadiusString)
        : undefined;
  if (!dimension) {
    if (shapeValue.properties.has("borderRadius")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_RADIUS_UNRESOLVED",
        message: `Theme '${themeId}' exposes a borderRadius surface without an extractable static value.`,
        bundlePath,
        themeId,
        tokenPath: [THEME_CONTEXT_PREFIX, themeId, "radius", "shape", "border-radius"]
      });
    }
    return 0;
  }

  addTokenEntry({
    tokenGraphByPath,
    themeId,
    path: [THEME_CONTEXT_PREFIX, themeId, "radius", "shape", "border-radius"],
    tokenClass: "radius",
    tokenType: "dimension",
    value: dimension,
    evidenceItems,
    diagnostics,
    isBackfilled: false
  });
  return 1;
};

const extractZIndexTokens = ({
  zIndexValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  bundlePath,
  evidenceItems
}: {
  zIndexValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!zIndexValue) {
    return 0;
  }
  if (!isJsStaticObjectValue(zIndexValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_Z_INDEX_UNRESOLVED",
      message: `Theme '${themeId}' exposes a zIndex surface that is not statically evaluable.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "z-index"]
    });
    return 0;
  }

  let extractedCount = 0;
  for (const [key, entryValue] of zIndexValue.properties.entries()) {
    if (!isJsStaticNumberValue(entryValue)) {
      continue;
    }
    extractedCount += 1;
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "z-index", normalizeNameSegment(key)],
      tokenClass: "z-index",
      tokenType: "number",
      value: entryValue.value,
      evidenceItems,
      diagnostics,
      isBackfilled: false
    });
  }

  if (zIndexValue.properties.size > 0 && extractedCount === 0) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_Z_INDEX_UNRESOLVED",
      message: `Theme '${themeId}' exposes zIndex surfaces without extractable static numeric values.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "z-index"]
    });
  }

  return extractedCount;
};

const extractComponentSurfaceTokens = ({
  componentsValue,
  themeId,
  tokenGraphByPath,
  diagnostics,
  evidenceItems
}: {
  componentsValue: JsStaticValue | undefined;
  themeId: string;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  if (!componentsValue || !isJsStaticObjectValue(componentsValue)) {
    return 0;
  }

  let extractedCount = 0;
  const visitComponentObject = ({
    value,
    objectPath
  }: {
    value: JsStaticValue;
    objectPath: string[];
  }): void => {
    if (isJsStaticObjectValue(value)) {
      const typographyComposite = buildTypographyCompositeValue({
        variantValue: value
      });
      if (typographyComposite) {
        extractedCount += 1;
        addTokenEntry({
          tokenGraphByPath,
          themeId,
          path: [THEME_CONTEXT_PREFIX, themeId, "typography", "components", ...objectPath],
          tokenClass: "typography",
          tokenType: "typography",
          value: typographyComposite,
          evidenceItems,
          diagnostics,
          isBackfilled: false
        });
      }

      for (const [key, nestedValue] of value.properties.entries()) {
        const normalizedKey = normalizeNameSegment(key);
        if (COLOR_PROPERTY_KEYS.has(key) && isJsStaticStringValue(nestedValue)) {
          const colorTokenValue = toColorTokenValue(nestedValue.value);
          if (colorTokenValue) {
            extractedCount += 1;
            addTokenEntry({
              tokenGraphByPath,
              themeId,
              path: [THEME_CONTEXT_PREFIX, themeId, "color", "components", ...objectPath, normalizedKey],
              tokenClass: "color",
              tokenType: "color",
              value: colorTokenValue,
              evidenceItems,
              diagnostics,
              isBackfilled: false
            });
            continue;
          }
        }

        if (
          (isSpacingPropertyKey(key) || key === "borderRadius" || isDimensionPropertyKey(key)) &&
          (isJsStaticNumberValue(nestedValue) || isJsStaticStringValue(nestedValue))
        ) {
          const rawValue = nestedValue.value;
          const dimension = parseDimensionValue(rawValue);
          if (dimension) {
            const tokenClass: StorybookTokenClass =
              key === "borderRadius" ? "radius" : isSpacingPropertyKey(key) || key === "spacing" ? "spacing" : "dimension";
            extractedCount += 1;
            addTokenEntry({
              tokenGraphByPath,
              themeId,
              path: [THEME_CONTEXT_PREFIX, themeId, tokenClass, "components", ...objectPath, normalizedKey],
              tokenClass,
              tokenType: "dimension",
              value: dimension,
              evidenceItems,
              diagnostics,
              isBackfilled: false
            });
            continue;
          }
        }

        if (key === "zIndex" && isJsStaticNumberValue(nestedValue)) {
          extractedCount += 1;
          addTokenEntry({
            tokenGraphByPath,
            themeId,
            path: [THEME_CONTEXT_PREFIX, themeId, "z-index", "components", ...objectPath],
            tokenClass: "z-index",
            tokenType: "number",
            value: nestedValue.value,
            evidenceItems,
            diagnostics,
            isBackfilled: false
          });
          continue;
        }

        if (isJsStaticObjectValue(nestedValue)) {
          visitComponentObject({
            value: nestedValue,
            objectPath: [...objectPath, normalizedKey]
          });
          continue;
        }

        if (isJsStaticArrayValue(nestedValue)) {
          nestedValue.values.forEach((entryValue, index) => {
            visitComponentObject({
              value: entryValue,
              objectPath: [...objectPath, normalizedKey, String(index)]
            });
          });
        }
      }
    } else if (isJsStaticArrayValue(value)) {
      value.values.forEach((entryValue, index) => {
        visitComponentObject({
          value: entryValue,
          objectPath: [...objectPath, String(index)]
        });
      });
    }
  };

  for (const [componentName, componentValue] of componentsValue.properties.entries()) {
    visitComponentObject({
      value: componentValue,
      objectPath: [normalizeNameSegment(componentName)]
    });
  }

  return extractedCount;
};

const getThemeColorTokenValue = ({
  tokenGraphByPath,
  themeId,
  pathSuffix
}: {
  tokenGraphByPath: ReadonlyMap<string, StorybookTokenGraphEntry>;
  themeId: string;
  pathSuffix: string[];
}): unknown | undefined => {
  const entry = tokenGraphByPath.get(toPathKey([THEME_CONTEXT_PREFIX, themeId, "color", ...pathSuffix]));
  return entry?.tokenType === "color" ? entry.value : undefined;
};

const addDerivedBackgroundToken = ({
  tokenGraphByPath,
  themeId,
  diagnostics,
  evidenceItems,
  slot,
  candidatePaths,
  description
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  themeId: string;
  diagnostics: StorybookThemeDiagnostic[];
  evidenceItems: StorybookEvidenceItem[];
  slot: "default" | "paper";
  candidatePaths: string[][];
  description: string;
}): boolean => {
  const existingValue = getThemeColorTokenValue({
    tokenGraphByPath,
    themeId,
    pathSuffix: ["background", slot]
  });
  if (existingValue !== undefined) {
    return false;
  }

  for (const candidatePath of candidatePaths) {
    const candidateValue = getThemeColorTokenValue({
      tokenGraphByPath,
      themeId,
      pathSuffix: candidatePath
    });
    if (candidateValue === undefined) {
      continue;
    }
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "color", "background", slot],
      tokenClass: "color",
      tokenType: "color",
      value: candidateValue,
      evidenceItems,
      diagnostics,
      isBackfilled: false,
      description
    });
    return true;
  }

  return false;
};

const extractDerivedBackgroundTokens = ({
  tokenGraphByPath,
  themeId,
  diagnostics,
  evidenceItems
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  themeId: string;
  diagnostics: StorybookThemeDiagnostic[];
  evidenceItems: StorybookEvidenceItem[];
}): number => {
  let extractedCount = 0;

  if (
    addDerivedBackgroundToken({
      tokenGraphByPath,
      themeId,
      diagnostics,
      evidenceItems,
      slot: "default",
      candidatePaths: [
        ["components", "mui-css-baseline", "style-overrides", "body", "background-color"],
        ["supplementary", "dark"],
        ["supplementary", "main"],
        ["background", "paper"]
      ],
      description: "Derived from authoritative Storybook surface defaults because palette.background.default was absent."
    })
  ) {
    extractedCount += 1;
  }

  if (
    addDerivedBackgroundToken({
      tokenGraphByPath,
      themeId,
      diagnostics,
      evidenceItems,
      slot: "paper",
      candidatePaths: [
        ["supplementary", "light"],
        ["weiss", "main"],
        ["supplementary", "main"],
        ["background", "default"]
      ],
      description: "Derived from authoritative Storybook surface defaults because palette.background.paper was absent."
    })
  ) {
    extractedCount += 1;
  }

  return extractedCount;
};

const hasMuiThemeFactorySignal = ({
  evidenceItems
}: {
  evidenceItems: StorybookEvidenceItem[];
}): boolean => {
  return evidenceItems.some((evidenceItem) => {
    if (evidenceItem.type !== "theme_bundle") {
      return false;
    }
    const themeMarkers = evidenceItem.summary.themeMarkers ?? [];
    return themeMarkers.includes("createTheme") || themeMarkers.includes("extendTheme");
  });
};

const extractMuiDefaultFoundationTokens = ({
  tokenGraphByPath,
  themeId,
  diagnostics,
  evidenceItems,
  allowSpacingDefault,
  allowShapeDefault
}: {
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  themeId: string;
  diagnostics: StorybookThemeDiagnostic[];
  evidenceItems: StorybookEvidenceItem[];
  allowSpacingDefault: boolean;
  allowShapeDefault: boolean;
}): number => {
  if (!hasMuiThemeFactorySignal({ evidenceItems })) {
    return 0;
  }

  let extractedCount = 0;
  if (allowSpacingDefault && !tokenGraphByPath.has(toPathKey([THEME_CONTEXT_PREFIX, themeId, "spacing", "base"]))) {
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "base"],
      tokenClass: "spacing",
      tokenType: "dimension",
      value: { value: 8, unit: "px" },
      evidenceItems,
      diagnostics,
      isBackfilled: true,
      description: "Derived from the MUI createTheme/extendTheme default spacing because theme.spacing was absent."
    });
    extractedCount += 1;
  }

  if (
    allowShapeDefault &&
    !tokenGraphByPath.has(toPathKey([THEME_CONTEXT_PREFIX, themeId, "radius", "shape", "border-radius"]))
  ) {
    addTokenEntry({
      tokenGraphByPath,
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "radius", "shape", "border-radius"],
      tokenClass: "radius",
      tokenType: "dimension",
      value: { value: 4, unit: "px" },
      evidenceItems,
      diagnostics,
      isBackfilled: true,
      description: "Derived from the MUI createTheme/extendTheme default shape.borderRadius because theme.shape was absent."
    });
    extractedCount += 1;
  }

  return extractedCount;
};

const summarizeThemeCategories = ({
  themeId,
  tokens
}: {
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
}): string[] => {
  const categories = new Set<string>();
  for (const token of tokens) {
    if (token.path[0] !== THEME_CONTEXT_PREFIX || token.path[1] !== themeId) {
      continue;
    }
    const category = token.path[2];
    if (category) {
      categories.add(category);
    }
  }
  return uniqueSorted([...categories]);
};

const countThemeTokens = ({
  themeId,
  tokens
}: {
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
}): number => {
  return tokens.filter((token) => token.path[0] === THEME_CONTEXT_PREFIX && token.path[1] === themeId).length;
};

const scoreExtractedThemeGroup = ({
  candidate,
  themes,
  tokens
}: {
  candidate: StorybookThemeCandidate;
  themes: StorybookExtractedTheme[];
  tokens: StorybookTokenGraphEntry[];
}): number => {
  const categoryCount = themes.reduce((total, theme) => total + theme.categories.length, 0);
  return candidate.score * 1000 + tokens.length * 25 + themes.length * 250 + categoryCount * 40;
};

const resolveContextValue = ({
  contextValue,
  key,
  baseValue
}: {
  contextValue: JsStaticValue;
  key: string;
  baseValue: JsStaticValue | undefined;
}): JsStaticValue | undefined => {
  return getObjectProperty(contextValue, key) ?? baseValue;
};

const extractThemeContexts = ({
  evaluatedTheme,
  themeName,
  bundlePath,
  diagnostics,
  evidenceItems
}: {
  evaluatedTheme: JsStaticValue;
  themeName: string;
  bundlePath: string;
  diagnostics: StorybookThemeDiagnostic[];
  evidenceItems: StorybookEvidenceItem[];
}): {
  themes: StorybookExtractedTheme[];
  tokens: StorybookTokenGraphEntry[];
  foundationPresenceByThemeId: Map<string, { hasExplicitSpacing: boolean; hasExplicitShape: boolean }>;
} => {
  const tokenGraphByPath = new Map<string, StorybookTokenGraphEntry>();
  const themes: StorybookExtractedTheme[] = [];
  const foundationPresenceByThemeId = new Map<string, { hasExplicitSpacing: boolean; hasExplicitShape: boolean }>();
  if (!isJsStaticObjectValue(evaluatedTheme)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_OBJECT_UNRESOLVED",
      message: `Theme candidate '${themeName}' could not be statically evaluated into an object.`,
      bundlePath
    });
    return { themes, tokens: [], foundationPresenceByThemeId };
  }

  const colorSchemes = evaluatedTheme.properties.get("colorSchemes");
  const basePalette = evaluatedTheme.properties.get("palette");
  const baseTypography = evaluatedTheme.properties.get("typography");
  const baseSpacing = evaluatedTheme.properties.get("spacing");
  const baseShape = evaluatedTheme.properties.get("shape");
  const baseComponents = evaluatedTheme.properties.get("components");
  const baseZIndex = evaluatedTheme.properties.get("zIndex");

  const contexts: Array<[string, JsStaticValue]> =
    colorSchemes && isJsStaticObjectValue(colorSchemes)
      ? [...colorSchemes.properties.entries()].map(([contextName, contextValue]) => [contextName, contextValue])
      : [["default", { kind: "object", properties: new Map<string, JsStaticValue>() }]];

  for (const [contextName, contextValue] of contexts) {
    const themeId = normalizeNameSegment(contextName);
    const contextPalette = resolveContextValue({
      contextValue,
      key: "palette",
      baseValue: basePalette
    });
    const contextTypography = resolveContextValue({
      contextValue,
      key: "typography",
      baseValue: baseTypography
    });
    const contextSpacing = resolveContextValue({
      contextValue,
      key: "spacing",
      baseValue: baseSpacing
    });
    const contextShape = resolveContextValue({
      contextValue,
      key: "shape",
      baseValue: baseShape
    });
    const contextComponents = resolveContextValue({
      contextValue,
      key: "components",
      baseValue: baseComponents
    });
    const contextZIndex = resolveContextValue({
      contextValue,
      key: "zIndex",
      baseValue: baseZIndex
    });

    if (contextPalette) {
      extractPaletteTokens({
        paletteValue: contextPalette,
        themeId,
        tokenGraphByPath,
        diagnostics,
        bundlePath,
        evidenceItems
      });
    }
    extractSpacingTokens({
      spacingValue: contextSpacing,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractTypographyTokens({
      typographyValue: contextTypography,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractComponentSurfaceTokens({
      componentsValue: contextComponents,
      themeId,
      tokenGraphByPath,
      diagnostics,
      evidenceItems
    });
    extractFontFaceTokens({
      componentsValue: contextComponents,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractRadiusTokens({
      shapeValue: contextShape,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractZIndexTokens({
      zIndexValue: contextZIndex,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractDerivedBackgroundTokens({
      tokenGraphByPath,
      themeId,
      diagnostics,
      evidenceItems
    });
    foundationPresenceByThemeId.set(themeId, {
      hasExplicitSpacing: contextSpacing !== undefined,
      hasExplicitShape: contextShape !== undefined
    });

    const themeTokens = [...tokenGraphByPath.values()];
    themes.push({
      id: themeId,
      name: themeName,
      context: contextName,
      categories: summarizeThemeCategories({
        themeId,
        tokens: themeTokens
      }),
      tokenCount: countThemeTokens({
        themeId,
        tokens: themeTokens
      })
    });
  }

  return {
    themes,
    tokens: [...tokenGraphByPath.values()].sort((left, right) => left.id.localeCompare(right.id)),
    foundationPresenceByThemeId
  };
};

const selectBestThemeBundleExtraction = async ({
  buildDir,
  evidenceItem
}: {
  buildDir: string;
  evidenceItem: StorybookEvidenceItem;
}): Promise<ThemeBundleExtraction | undefined> => {
  const bundlePath = evidenceItem.source.bundlePath;
  if (typeof bundlePath !== "string") {
    return undefined;
  }

  const normalizedBundlePath = normalizePosixPath(bundlePath);
  const bundleText = await readFile(path.join(buildDir, normalizedBundlePath), "utf8");
  const candidates = collectMuiThemeCandidates({
    bundlePath: normalizedBundlePath,
    bundleText
  }).slice(0, 3);

  if (candidates.length === 0) {
    return {
      bundlePath: normalizedBundlePath,
      themeName: path.basename(normalizedBundlePath, path.extname(normalizedBundlePath)),
      themes: [],
      tokenGraph: [],
      diagnostics: [
        {
          severity: "error",
          code: "MUI_THEME_CANDIDATE_MISSING",
          message: "No statically extractable exported MUI theme object candidate was found.",
          bundlePath: normalizedBundlePath
        }
      ],
      score: 0,
      themeMarkers: uniqueSorted(evidenceItem.summary.themeMarkers ?? []),
      evidenceItems: [evidenceItem],
      foundationPresenceByThemeId: new Map<string, { hasExplicitSpacing: boolean; hasExplicitShape: boolean }>()
    };
  }

  const env = createJsEvaluationEnvironment(bundleText);
  let selected: ThemeBundleExtraction | undefined;
  for (const candidate of candidates) {
    const localDiagnostics: StorybookThemeDiagnostic[] = [];
    const evaluationState = createEvaluationState();
    const evaluatedTheme = evaluateJsExpression({
      source: candidate.objectText,
      env,
      state: evaluationState
    });

    for (const diagnostic of evaluationState.diagnostics) {
      pushDiagnostic({
        diagnostics: localDiagnostics,
        severity: "warning",
        code: diagnostic.code,
        message: diagnostic.message,
        bundlePath: normalizedBundlePath
      });
    }

    const extracted = extractThemeContexts({
      evaluatedTheme,
      themeName: path.basename(normalizedBundlePath, path.extname(normalizedBundlePath)),
      bundlePath: normalizedBundlePath,
      diagnostics: localDiagnostics,
      evidenceItems: [evidenceItem]
    });
    const score = scoreExtractedThemeGroup({
      candidate,
      themes: extracted.themes,
      tokens: extracted.tokens
    });

    const candidateExtraction: ThemeBundleExtraction = {
      bundlePath: normalizedBundlePath,
      themeName: path.basename(normalizedBundlePath, path.extname(normalizedBundlePath)),
      themes: extracted.themes,
      tokenGraph: extracted.tokens,
      diagnostics: localDiagnostics,
      score,
      themeMarkers: uniqueSorted(evidenceItem.summary.themeMarkers ?? []),
      evidenceItems: [evidenceItem],
      foundationPresenceByThemeId: extracted.foundationPresenceByThemeId
    };
    if (!selected || candidateExtraction.score > selected.score) {
      selected = candidateExtraction;
    }
  }

  return selected;
};

const applyCssAliases = ({
  definitions,
  tokens
}: {
  definitions: Array<{ name: string; value: string }>;
  tokens: StorybookTokenGraphEntry[];
}): Set<string> => {
  const variableNamesByComparableValue = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const key = toComparableTokenValue(
      toColorTokenValue(definition.value) ??
        parseDimensionString(definition.value) ??
        parsePlainNumberString(definition.value) ??
        definition.value
    );
    if (!key) {
      continue;
    }
    const existing = variableNamesByComparableValue.get(key) ?? new Set<string>();
    existing.add(definition.name);
    variableNamesByComparableValue.set(key, existing);
  }

  const matchedVariableNames = new Set<string>();
  for (const token of tokens) {
    const comparableValue = toComparableTokenValue(token.value);
    if (!comparableValue) {
      continue;
    }
    const cssVariableNames = variableNamesByComparableValue.get(comparableValue);
    if (!cssVariableNames || cssVariableNames.size === 0) {
      continue;
    }
    token.cssVariableNames = uniqueSorted([...(token.cssVariableNames ?? []), ...cssVariableNames]);
    for (const cssVariableName of cssVariableNames) {
      matchedVariableNames.add(cssVariableName);
    }
  }

  return matchedVariableNames;
};

const classifyCssDefinition = ({
  definition
}: {
  definition: { name: string; value: string };
}):
  | {
      tokenClass: StorybookTokenClass;
      tokenType: StorybookTokenValueType;
      value: unknown;
      normalizedName: string;
      pathSuffix: string[];
    }
  | undefined => {
  const normalizedName = normalizeVariableName(definition.name);
  const colorValue = toColorTokenValue(definition.value);
  if (colorValue) {
    return {
      tokenClass: "color",
      tokenType: "color",
      value: colorValue,
      normalizedName,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }

  const plainNumber = parsePlainNumberString(definition.value);
  if (plainNumber !== undefined && /(^|-)z(-?index)?($|-)/u.test(normalizedName)) {
    return {
      tokenClass: "z-index",
      tokenType: "number",
      value: plainNumber,
      normalizedName,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }

  const dimension = parseDimensionString(definition.value);
  if (!dimension) {
    return undefined;
  }
  if (normalizedName.includes("radius")) {
    return {
      tokenClass: "radius",
      tokenType: "dimension",
      value: dimension,
      normalizedName,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }
  if (/(^|-)space|spacing|gap|padding|margin/u.test(normalizedName)) {
    return {
      tokenClass: "spacing",
      tokenType: "dimension",
      value: dimension,
      normalizedName,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }
  if (/(^|-)width|height|min|max/u.test(normalizedName)) {
    return {
      tokenClass: "dimension",
      tokenType: "dimension",
      value: dimension,
      normalizedName,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }
  return undefined;
};

const toCanonicalCssThemePathSuffix = ({
  tokenClass,
  normalizedName
}: {
  tokenClass: StorybookTokenClass;
  normalizedName: string;
}): string[] | undefined => {
  if (
    tokenClass === "spacing" &&
    (/(^|-)fi-space-base$/u.test(normalizedName) ||
      /(^|-)space-base($|-)/u.test(normalizedName) ||
      /(^|-)spacing-base($|-)/u.test(normalizedName) ||
      /(^|-)base-spacing($|-)/u.test(normalizedName))
  ) {
    return ["base"];
  }

  if (
    tokenClass === "radius" &&
    (/^border-radius$/u.test(normalizedName) ||
      /(^|-)border-radius($|-)/u.test(normalizedName) ||
      /(^|-)shape-border-radius($|-)/u.test(normalizedName))
  ) {
    return ["shape", "border-radius"];
  }

  return undefined;
};

const applyCssDirectTokens = ({
  themes,
  cssEvidenceItems,
  cssDefinitionsByPath,
  tokenGraphByPath,
  diagnostics
}: {
  themes: StorybookExtractedTheme[];
  cssEvidenceItems: StorybookEvidenceItem[];
  cssDefinitionsByPath: ReadonlyMap<string, Array<{ name: string; value: string }>>;
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
}): void => {
  for (const theme of themes) {
    for (const evidenceItem of cssEvidenceItems) {
      const stylesheetPath = evidenceItem.source.stylesheetPath;
      if (typeof stylesheetPath !== "string") {
        continue;
      }
      const definitions = cssDefinitionsByPath.get(stylesheetPath) ?? [];
      for (const definition of definitions) {
        const classified = classifyCssDefinition({ definition });
        if (!classified) {
          continue;
        }
        const canonicalPathSuffix = toCanonicalCssThemePathSuffix({
          tokenClass: classified.tokenClass,
          normalizedName: classified.normalizedName
        });
        if (canonicalPathSuffix) {
          addTokenEntry({
            tokenGraphByPath,
            themeId: theme.id,
            path: [THEME_CONTEXT_PREFIX, theme.id, classified.tokenClass, ...canonicalPathSuffix],
            tokenClass: classified.tokenClass,
            tokenType: classified.tokenType,
            value: classified.value,
            evidenceItems: [evidenceItem],
            diagnostics,
            isBackfilled: false,
            cssVariableNames: [definition.name]
          });
        }
        addTokenEntry({
          tokenGraphByPath,
          themeId: theme.id,
          path: [THEME_CONTEXT_PREFIX, theme.id, classified.tokenClass, ...classified.pathSuffix],
          tokenClass: classified.tokenClass,
          tokenType: classified.tokenType,
          value: classified.value,
          evidenceItems: [evidenceItem],
          diagnostics,
          isBackfilled: false,
          cssVariableNames: [definition.name]
        });
      }
    }
  }
};

const hasAmbiguousSupplementaryThemeScope = ({
  themeCount,
  diagnostics,
  diagnosticCode,
  message
}: {
  themeCount: number;
  diagnostics: StorybookThemeDiagnostic[];
  diagnosticCode: string;
  message: string;
}): boolean => {
  if (themeCount <= 1) {
    return false;
  }
  pushDiagnostic({
    diagnostics,
    severity: "error",
    code: diagnosticCode,
    message
  });
  return true;
};

const resolveThemeCategories = ({
  themes,
  tokens
}: {
  themes: StorybookExtractedTheme[];
  tokens: StorybookTokenGraphEntry[];
}): StorybookExtractedTheme[] => {
  return themes
    .map((theme) => ({
      ...theme,
      categories: summarizeThemeCategories({
        themeId: theme.id,
        tokens
      }),
      tokenCount: countThemeTokens({
        themeId: theme.id,
        tokens
      })
    }))
    .sort(compareThemes);
};

const getMissingRequiredClasses = ({
  theme
}: {
  theme: StorybookExtractedTheme;
}): Set<StorybookTokenClass> => {
  const missing = new Set<StorybookTokenClass>();
  if (!theme.categories.includes("color")) {
    missing.add("color");
  }
  if (!theme.categories.includes("spacing")) {
    missing.add("spacing");
  }
  if (!theme.categories.includes("typography") && !theme.categories.includes("font")) {
    missing.add("typography");
    missing.add("font");
  }
  return missing;
};

const isPotentialStoryTokenField = ({
  fieldName,
  value
}: {
  fieldName: string;
  value?: StaticJsonValue;
}): boolean => {
  if (value !== undefined) {
    return classifyStoryField({ fieldName, value }).length > 0;
  }

  return (
    isSpacingPropertyKey(fieldName) ||
    fieldName === "palette" ||
    fieldName === "fontFamily" ||
    fieldName === "zIndex" ||
    fieldName === "borderRadius" ||
    isDimensionPropertyKey(fieldName)
  );
};

const classifyStoryField = ({
  fieldName,
  value
}: {
  fieldName: string;
  value: StaticJsonValue;
}): StoryBackfillCandidate[] => {
  const normalizedFieldName = normalizeNameSegment(fieldName);

  if (fieldName === "palette" && isStaticJsonRecord(value)) {
    const candidates: StoryBackfillCandidate[] = [];
    const visitPaletteObject = ({
      record,
      pathSegments
    }: {
      record: Record<string, StaticJsonValue>;
      pathSegments: string[];
    }): void => {
      for (const [key, nestedValue] of Object.entries(record)) {
        if (typeof nestedValue === "string") {
          const tokenValue = toColorTokenValue(nestedValue);
          if (tokenValue) {
            candidates.push({
              tokenClass: "color",
              tokenType: "color",
              value: tokenValue,
              pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, ...pathSegments, normalizeNameSegment(key)]
            });
          }
          continue;
        }
        if (isStaticJsonRecord(nestedValue)) {
          visitPaletteObject({
            record: nestedValue,
            pathSegments: [...pathSegments, normalizeNameSegment(key)]
          });
        }
      }
    };

    visitPaletteObject({
      record: value,
      pathSegments: [normalizedFieldName]
    });
    return candidates;
  }

  if (hasTypographyFieldsInStaticJson(value)) {
    const composite = buildTypographyCompositeFromStaticJson({
      value
    });
    if (composite) {
      return [
        {
          tokenClass: "typography",
          tokenType: "typography",
          value: composite,
          pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, normalizedFieldName]
        }
      ];
    }
  }

  if (COLOR_PROPERTY_KEYS.has(fieldName) && typeof value === "string") {
    const tokenValue = toColorTokenValue(value);
    if (tokenValue) {
      return [
        {
          tokenClass: "color",
          tokenType: "color",
          value: tokenValue,
          pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, normalizedFieldName]
        }
      ];
    }
  }

  if ((isSpacingPropertyKey(fieldName) || fieldName === "borderRadius" || isDimensionPropertyKey(fieldName)) && (typeof value === "string" || typeof value === "number")) {
    const dimension = parseDimensionValue(value);
    if (!dimension) {
      return [];
    }
    const tokenClass: StorybookTokenClass =
      fieldName === "borderRadius" ? "radius" : isSpacingPropertyKey(fieldName) || fieldName === "spacing" ? "spacing" : "dimension";
    return [
      {
        tokenClass,
        tokenType: "dimension",
        value: dimension,
        pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, normalizedFieldName]
      }
    ];
  }

  if (fieldName === "zIndex" && typeof value === "number") {
    return [
      {
        tokenClass: "z-index",
        tokenType: "number",
        value,
        pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, normalizedFieldName]
      }
    ];
  }

  if (fieldName === "fontFamily" && typeof value === "string") {
    return [
      {
        tokenClass: "font",
        tokenType: "fontFamily",
        value,
        pathSuffix: [STORYBACKFILL_CONTEXT_PREFIX, "font", "family", normalizeNameSegment(value)]
      }
    ];
  }

  return [];
};

const readStoryFieldStaticRecord = ({
  bundleText,
  evidenceItem
}: {
  bundleText: string;
  evidenceItem: StorybookEvidenceItem;
}): StoryFieldStaticRecordResult => {
  if (evidenceItem.type === "story_args") {
    const extraction = extractStaticObjectFieldDetails({
      bundleText,
      fieldName: "args"
    });
    return {
      staticRecord: extraction.mergeResult.record,
      conflictingKeys: extraction.mergeResult.conflictingKeys,
      conflictingValuesByKey: collectConflictingStaticValuesByKey({
        records: extraction.records,
        conflictingKeys: extraction.mergeResult.conflictingKeys
      })
    };
  }

  if (evidenceItem.type === "story_argTypes") {
    const extraction = extractStaticObjectFieldDetails({
      bundleText,
      fieldName: "argTypes"
    });
    const normalizedArgTypeRecords = extraction.records
      .map((argTypes) => {
        const normalized: Record<string, StaticJsonValue> = {};
        for (const [key, value] of Object.entries(argTypes)) {
          if (!isStaticJsonRecord(value)) {
            continue;
          }
          if ("defaultValue" in value) {
            normalized[key] = value.defaultValue;
            continue;
          }
          const table = value.table;
          if (
            isStaticJsonRecord(table) &&
            isStaticJsonRecord(table.defaultValue) &&
            typeof table.defaultValue.summary === "string"
          ) {
            normalized[key] = table.defaultValue.summary;
          }
        }
        return normalized;
      })
      .filter((record) => Object.keys(record).length > 0);
    const mergeResult = mergeStaticJsonRecords({
      records: normalizedArgTypeRecords
    });
    return {
      staticRecord: mergeResult.record,
      conflictingKeys: uniqueSorted([...extraction.mergeResult.conflictingKeys, ...mergeResult.conflictingKeys]),
      conflictingValuesByKey: collectConflictingStaticValuesByKey({
        records: normalizedArgTypeRecords,
        conflictingKeys: uniqueSorted([...extraction.mergeResult.conflictingKeys, ...mergeResult.conflictingKeys])
      })
    };
  }

  return {
    staticRecord: undefined,
    conflictingKeys: [],
    conflictingValuesByKey: {}
  };
};

const applyStoryBackfillTokens = async ({
  buildDir,
  storyEvidenceItems,
  themes,
  tokenGraphByPath,
  diagnostics
}: {
  buildDir: string;
  storyEvidenceItems: StorybookEvidenceItem[];
  themes: StorybookExtractedTheme[];
  tokenGraphByPath: Map<string, StorybookTokenGraphEntry>;
  diagnostics: StorybookThemeDiagnostic[];
}): Promise<void> => {
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));

  for (const evidenceItem of storyEvidenceItems) {
    const bundlePath = evidenceItem.source.bundlePath;
    if (typeof bundlePath !== "string") {
      continue;
    }

    const bundleText = await readFile(path.join(buildDir, bundlePath), "utf8");
    const storyFieldRecord = readStoryFieldStaticRecord({
      bundleText,
      evidenceItem
    });
    const staticRecord = storyFieldRecord.staticRecord;
    const declaredKeys = new Set(evidenceItem.summary.keys ?? []);
    const extractedKeys = new Set(Object.keys(staticRecord ?? {}));
    const conflictingKeys = new Set(storyFieldRecord.conflictingKeys);

    for (const conflictingKey of [...conflictingKeys].sort((left, right) => left.localeCompare(right))) {
      const representativeConflictValue = storyFieldRecord.conflictingValuesByKey[conflictingKey]?.find((value) => {
        return classifyStoryField({
          fieldName: conflictingKey,
          value
        }).length > 0;
      });
      if (
        !isPotentialStoryTokenField({
          fieldName: conflictingKey,
          ...(representativeConflictValue !== undefined ? { value: representativeConflictValue } : {})
        })
      ) {
        continue;
      }
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "STORYBOOK_BACKFILL_VALUE_CONFLICT",
        message:
          `Storybook ${evidenceItem.type === "story_args" ? "args" : "argTypes"} declared conflicting static values for ` +
          `'${conflictingKey}'.`,
        bundlePath,
        tokenPath: [STORYBACKFILL_CONTEXT_PREFIX, normalizeNameSegment(conflictingKey)]
      });
    }

    for (const declaredKey of [...declaredKeys].sort((left, right) => left.localeCompare(right))) {
      if (
        !conflictingKeys.has(declaredKey) &&
        !extractedKeys.has(declaredKey) &&
        isPotentialStoryTokenField({
          fieldName: declaredKey,
          ...(staticRecord?.[declaredKey] !== undefined ? { value: staticRecord[declaredKey] } : {})
        })
      ) {
        pushDiagnostic({
          diagnostics,
          severity: "warning",
          code: "STORYBOOK_BACKFILL_VALUE_UNRESOLVED",
          message: `Storybook ${evidenceItem.type === "story_args" ? "args" : "argTypes"} declared '${declaredKey}' without a static backfill value.`,
          bundlePath
        });
      }
    }

    if (!staticRecord) {
      continue;
    }

    for (const theme of resolveThemeCategories({
      themes: [...themeById.values()],
      tokens: [...tokenGraphByPath.values()]
    })) {
      const missingClasses = getMissingRequiredClasses({ theme });
      if (missingClasses.size === 0) {
        continue;
      }

      for (const [fieldName, value] of Object.entries(staticRecord).sort(([left], [right]) => left.localeCompare(right))) {
        const candidates = classifyStoryField({
          fieldName,
          value
        }).filter((candidate) => missingClasses.has(candidate.tokenClass) || (candidate.tokenClass === "font" && missingClasses.has("font")));

        for (const candidate of candidates) {
          if (candidate.tokenClass === "font" && candidate.tokenType === "fontFamily" && typeof candidate.value === "string") {
            addFontFamilyToken({
              tokenGraphByPath,
              diagnostics,
              themeId: theme.id,
              familyName: candidate.value,
              evidenceItems: [evidenceItem]
            });
            continue;
          }

          addTokenEntry({
            tokenGraphByPath,
            themeId: theme.id,
            path: [THEME_CONTEXT_PREFIX, theme.id, candidate.tokenClass, ...candidate.pathSuffix],
            tokenClass: candidate.tokenClass,
            tokenType: candidate.tokenType,
            value: candidate.value,
            evidenceItems: [evidenceItem],
            diagnostics,
            isBackfilled: true
          });
        }
      }
    }
  }
};

const appendMissingClassDiagnostics = ({
  themes,
  diagnostics
}: {
  themes: StorybookExtractedTheme[];
  diagnostics: StorybookThemeDiagnostic[];
}): void => {
  for (const theme of themes) {
    const categories = new Set(theme.categories);
    if (!categories.has("color")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_COLOR_MISSING",
        message: `Theme '${theme.id}' does not expose any authoritative color tokens.`,
        themeId: theme.id,
        tokenPath: [THEME_CONTEXT_PREFIX, theme.id, "color"]
      });
    }
    if (!categories.has("spacing")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_SPACING_MISSING",
        message: `Theme '${theme.id}' does not expose any authoritative spacing tokens.`,
        themeId: theme.id,
        tokenPath: [THEME_CONTEXT_PREFIX, theme.id, "spacing"]
      });
    }
    if (!categories.has("typography") && !categories.has("font")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_TYPOGRAPHY_OR_FONT_MISSING",
        message: `Theme '${theme.id}' does not expose authoritative typography or font tokens.`,
        themeId: theme.id,
        tokenPath: [THEME_CONTEXT_PREFIX, theme.id, "typography"]
      });
    }
  }
};

const appendLinkageDiagnostics = ({
  themes,
  tokens,
  diagnostics
}: {
  themes: StorybookExtractedTheme[];
  tokens: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
}): void => {
  const knownThemeIds = new Set(themes.map((theme) => theme.id));
  for (const token of tokens) {
    if (token.path[0] !== THEME_CONTEXT_PREFIX) {
      continue;
    }
    const linkedThemeId = token.path[1];
    if (!linkedThemeId || !knownThemeIds.has(linkedThemeId)) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "STORYBOOK_THEME_LINKAGE_INVALID",
        message: "Theme token graph contains a token that is not linked to an extracted theme context.",
        themeId: token.themeId,
        tokenPath: token.path
      });
    }
  }

  for (const theme of themes) {
    if (countThemeTokens({ themeId: theme.id, tokens }) > 0) {
      continue;
    }
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "STORYBOOK_THEME_LINKAGE_INVALID",
      message: `Theme '${theme.id}' does not resolve to any theme-scoped token set.`,
      themeId: theme.id
    });
  }
};

export const buildStorybookThemeCatalog = async ({
  buildDir,
  evidenceItems
}: {
  buildDir: string;
  evidenceItems: StorybookEvidenceItem[];
}): Promise<StorybookThemeCatalog> => {
  const authoritativeItems = evidenceItems.filter(
    (item) => item.reliability !== "reference_only" && item.usage.canDriveTokens
  );
  const diagnostics: StorybookThemeDiagnostic[] = [];
  if (authoritativeItems.length === 0) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "STORYBOOK_AUTHORITATIVE_TOKEN_EVIDENCE_MISSING",
      message: "No authoritative Storybook token-driving evidence was found."
    });
    return {
      themes: [],
      tokenGraph: [],
      diagnostics
    };
  }

  const themeBundleEvidenceItems = authoritativeItems
    .filter((item) => item.type === "theme_bundle")
    .sort((left, right) =>
      compareBundlePaths({
        left: normalizePosixPath(left.source.bundlePath ?? ""),
        right: normalizePosixPath(right.source.bundlePath ?? "")
      })
    );
  const cssEvidenceItems = authoritativeItems.filter((item) => item.type === "css");
  const storyEvidenceItems = authoritativeItems
    .filter((item) => item.type === "story_args" || item.type === "story_argTypes")
    .sort((left, right) => left.id.localeCompare(right.id));

  const tokenGraphByPath = new Map<string, StorybookTokenGraphEntry>();
  const themesById = new Map<string, StorybookExtractedTheme>();
  const themeEvidenceItemsById = new Map<string, StorybookEvidenceItem[]>();
  const themeFoundationPresenceById = new Map<string, { hasExplicitSpacing: boolean; hasExplicitShape: boolean }>();
  const themeExtractions: ThemeBundleExtraction[] = [];
  for (const evidenceItem of themeBundleEvidenceItems) {
    const extraction = await selectBestThemeBundleExtraction({
      buildDir,
      evidenceItem
    });
    if (!extraction) {
      continue;
    }
    themeExtractions.push(extraction);
  }

  themeExtractions.sort(compareThemeExtractions);

  for (const extraction of themeExtractions) {
    const {
      duplicateThemeIds,
      conflictingTokenPaths,
      hasDuplicateThemeErrors
    } = findDuplicateThemeBundleConflicts({
      extraction,
      existingThemesById: themesById,
      tokenGraphByPath
    });

    if (duplicateThemeIds.length > 0 && (hasDuplicateThemeErrors || conflictingTokenPaths.length > 0)) {
      const conflictReason = hasDuplicateThemeErrors
        ? "it produced fatal extraction diagnostics for an already-selected theme context"
        : `it resolved conflicting values for token path(s): ${conflictingTokenPaths.join(", ")}`;
      pushDiagnostic({
        diagnostics,
        severity: "warning",
        code: "STORYBOOK_THEME_BUNDLE_SKIPPED",
        message: `Skipped Storybook theme bundle '${extraction.bundlePath}' because ${conflictReason}.`,
        bundlePath: extraction.bundlePath
      });
      continue;
    }

    diagnostics.push(...extraction.diagnostics);
    for (const theme of extraction.themes) {
      const existingEvidenceItems = themeEvidenceItemsById.get(theme.id) ?? [];
      const mergedEvidenceItemsById = new Map<string, StorybookEvidenceItem>();
      for (const item of [...existingEvidenceItems, ...extraction.evidenceItems]) {
        mergedEvidenceItemsById.set(item.id, item);
      }
      themeEvidenceItemsById.set(theme.id, [...mergedEvidenceItemsById.values()]);
      const extractionFoundationPresence = extraction.foundationPresenceByThemeId.get(theme.id);
      if (extractionFoundationPresence) {
        const existingFoundationPresence = themeFoundationPresenceById.get(theme.id);
        themeFoundationPresenceById.set(theme.id, {
          hasExplicitSpacing:
            (existingFoundationPresence?.hasExplicitSpacing ?? false) || extractionFoundationPresence.hasExplicitSpacing,
          hasExplicitShape:
            (existingFoundationPresence?.hasExplicitShape ?? false) || extractionFoundationPresence.hasExplicitShape
        });
      }
      const existing = themesById.get(theme.id);
      if (!existing) {
        themesById.set(theme.id, theme);
        continue;
      }
      themesById.set(theme.id, {
        ...existing,
        categories: uniqueSorted([...existing.categories, ...theme.categories]),
        tokenCount: existing.tokenCount + theme.tokenCount
      });
    }
    for (const token of extraction.tokenGraph) {
      mergeTokenEntry({
        tokenGraphByPath,
        entry: token,
        diagnostics
      });
    }
  }

  let tokenGraph = [...tokenGraphByPath.values()];
  let themes = resolveThemeCategories({
    themes: [...themesById.values()],
    tokens: tokenGraph
  });

  for (const theme of themes) {
    const themeEvidenceItems = themeEvidenceItemsById.get(theme.id) ?? [];
    const foundationPresence = themeFoundationPresenceById.get(theme.id) ?? {
      hasExplicitSpacing: false,
      hasExplicitShape: false
    };
    extractMuiDefaultFoundationTokens({
      tokenGraphByPath,
      themeId: theme.id,
      diagnostics,
      evidenceItems: themeEvidenceItems,
      allowSpacingDefault: !foundationPresence.hasExplicitSpacing,
      allowShapeDefault: !foundationPresence.hasExplicitShape
    });
  }

  tokenGraph = [...tokenGraphByPath.values()];
  themes = resolveThemeCategories({
    themes: [...themesById.values()],
    tokens: tokenGraph
  });

  if (themes.length === 0) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "STORYBOOK_EXPORTED_THEME_MISSING",
      message: "No exported Storybook theme could be extracted from authoritative theme bundles."
    });
  }

  const cssDefinitionsByPath = new Map<string, Array<{ name: string; value: string }>>();
  for (const evidenceItem of cssEvidenceItems) {
    const stylesheetPath = evidenceItem.source.stylesheetPath;
    if (typeof stylesheetPath !== "string") {
      continue;
    }
    const cssText = await readFile(path.join(buildDir, stylesheetPath), "utf8");
    const definitions = extractCssCustomPropertyDefinitions(cssText);
    cssDefinitionsByPath.set(stylesheetPath, definitions);
  }

  const matchedCssVariableNames = new Set<string>();
  for (const definitions of cssDefinitionsByPath.values()) {
    const matchedNames = applyCssAliases({
      definitions,
      tokens: tokenGraph
    });
    for (const matchedName of matchedNames) {
      matchedCssVariableNames.add(matchedName);
    }
  }

  const hasAmbiguousCssDefinitions =
    themes.length > 1 &&
    [...cssDefinitionsByPath.values()].some((definitions) =>
      definitions.some((definition) => classifyCssDefinition({ definition }) && !matchedCssVariableNames.has(definition.name))
    );

  if (hasAmbiguousCssDefinitions) {
    hasAmbiguousSupplementaryThemeScope({
      themeCount: themes.length,
      diagnostics,
      diagnosticCode: "STORYBOOK_CSS_THEME_SCOPE_AMBIGUOUS",
      message: "Authoritative CSS token sources cannot be scoped safely across multiple extracted theme contexts."
    });
  } else if (cssEvidenceItems.length > 0 && themes.length === 1) {
    applyCssDirectTokens({
      themes,
      cssEvidenceItems,
      cssDefinitionsByPath,
      tokenGraphByPath,
      diagnostics
    });
  }

  if (
    storyEvidenceItems.length > 0 &&
    !hasAmbiguousSupplementaryThemeScope({
      themeCount: themes.length,
      diagnostics,
      diagnosticCode: "STORYBOOK_BACKFILL_THEME_SCOPE_AMBIGUOUS",
      message: "Story args/argTypes token backfill cannot be scoped safely across multiple extracted theme contexts."
    })
  ) {
    await applyStoryBackfillTokens({
      buildDir,
      storyEvidenceItems,
      themes,
      tokenGraphByPath,
      diagnostics
    });
  }

  tokenGraph = [...tokenGraphByPath.values()].sort((left, right) => left.id.localeCompare(right.id));
  themes = resolveThemeCategories({
    themes: [...themesById.values()],
    tokens: tokenGraph
  });

  appendMissingClassDiagnostics({
    themes,
    diagnostics
  });
  appendLinkageDiagnostics({
    themes,
    tokens: tokenGraph,
    diagnostics
  });

  return {
    themes,
    tokenGraph,
    diagnostics: dedupeObjectArray(diagnostics).sort(compareDiagnostics)
  };
};
