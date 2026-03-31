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
import { extractStaticObjectField, type StaticJsonValue } from "./static-object-field.js";
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

interface ThemeBundleExtraction {
  bundlePath: string;
  themeName: string;
  themes: StorybookExtractedTheme[];
  tokenGraph: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
  score: number;
}

interface StoryBackfillCandidate {
  tokenClass: StorybookTokenClass;
  tokenType: StorybookTokenValueType;
  value: unknown;
  pathSuffix: string[];
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

const toColorTokenValue = (value: string): unknown => {
  return parseHexColor(value) ?? parseRgbColor(value);
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
    for (const [key, nestedValue] of value.properties.entries()) {
      if (isJsStaticStringValue(nestedValue)) {
        const tokenValue = toColorTokenValue(nestedValue.value);
        if (!tokenValue) {
          continue;
        }
        extractedCount += 1;
        addTokenEntry({
          tokenGraphByPath,
          themeId,
          path: [THEME_CONTEXT_PREFIX, themeId, "color", ...pathSegments, normalizeNameSegment(key)],
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
          pathSegments: [...pathSegments, normalizeNameSegment(key)]
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
}): { themes: StorybookExtractedTheme[]; tokens: StorybookTokenGraphEntry[] } => {
  const tokenGraphByPath = new Map<string, StorybookTokenGraphEntry>();
  const themes: StorybookExtractedTheme[] = [];
  if (!isJsStaticObjectValue(evaluatedTheme)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_OBJECT_UNRESOLVED",
      message: `Theme candidate '${themeName}' could not be statically evaluated into an object.`,
      bundlePath
    });
    return { themes, tokens: [] };
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
    const contextPalette = getObjectProperty(contextValue, "palette") ?? basePalette;

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
      spacingValue: baseSpacing,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractTypographyTokens({
      typographyValue: baseTypography,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractComponentSurfaceTokens({
      componentsValue: baseComponents,
      themeId,
      tokenGraphByPath,
      diagnostics,
      evidenceItems
    });
    extractFontFaceTokens({
      componentsValue: baseComponents,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractRadiusTokens({
      shapeValue: baseShape,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
    });
    extractZIndexTokens({
      zIndexValue: baseZIndex,
      themeId,
      tokenGraphByPath,
      diagnostics,
      bundlePath,
      evidenceItems
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
    tokens: [...tokenGraphByPath.values()].sort((left, right) => left.id.localeCompare(right.id))
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
      score: 0
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
      score
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
}): void => {
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
  }
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
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }

  const plainNumber = parsePlainNumberString(definition.value);
  if (plainNumber !== undefined && /(^|-)z(-?index)?($|-)/u.test(normalizedName)) {
    return {
      tokenClass: "z-index",
      tokenType: "number",
      value: plainNumber,
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
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }
  if (/(^|-)space|spacing|gap|padding|margin/u.test(normalizedName)) {
    return {
      tokenClass: "spacing",
      tokenType: "dimension",
      value: dimension,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
  }
  if (/(^|-)width|height|min|max/u.test(normalizedName)) {
    return {
      tokenClass: "dimension",
      tokenType: "dimension",
      value: dimension,
      pathSuffix: [CSS_CONTEXT_PREFIX, normalizedName]
    };
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
}): Record<string, StaticJsonValue> | undefined => {
  if (evidenceItem.type === "story_args") {
    return extractStaticObjectField({
      bundleText,
      fieldName: "args"
    });
  }

  if (evidenceItem.type === "story_argTypes") {
    const argTypes = extractStaticObjectField({
      bundleText,
      fieldName: "argTypes"
    });
    if (!argTypes) {
      return undefined;
    }

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
      if (isStaticJsonRecord(table) && isStaticJsonRecord(table.defaultValue) && typeof table.defaultValue.summary === "string") {
        normalized[key] = table.defaultValue.summary;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  return undefined;
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
    const staticRecord = readStoryFieldStaticRecord({
      bundleText,
      evidenceItem
    });
    const declaredKeys = new Set(evidenceItem.summary.keys ?? []);
    const extractedKeys = new Set(Object.keys(staticRecord ?? {}));

    for (const declaredKey of [...declaredKeys].sort((left, right) => left.localeCompare(right))) {
      if (!extractedKeys.has(declaredKey) && (COLOR_PROPERTY_KEYS.has(declaredKey) || isSpacingPropertyKey(declaredKey) || declaredKey === "palette" || hasTypographyFieldsInStaticJson(staticRecord?.[declaredKey]))) {
        pushDiagnostic({
          diagnostics,
          severity: "warning",
          code: "STORYBOOK_BACKFILL_VALUE_UNRESOLVED",
          message: `Storybook ${evidenceItem.type === "story_args" ? "args" : "argTypes"} declared '${declaredKey}' without a static backfill value.`
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

  for (const evidenceItem of themeBundleEvidenceItems) {
    const extraction = await selectBestThemeBundleExtraction({
      buildDir,
      evidenceItem
    });
    if (!extraction) {
      continue;
    }
    diagnostics.push(...extraction.diagnostics);
    for (const theme of extraction.themes) {
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

  for (const definitions of cssDefinitionsByPath.values()) {
    applyCssAliases({
      definitions,
      tokens: tokenGraph
    });
  }

  applyCssDirectTokens({
    themes,
    cssEvidenceItems,
    cssDefinitionsByPath,
    tokenGraphByPath,
    diagnostics
  });

  await applyStoryBackfillTokens({
    buildDir,
    storyEvidenceItems,
    themes,
    tokenGraphByPath,
    diagnostics
  });

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
