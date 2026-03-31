import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extractCssCustomPropertyDefinitions, extractThemeMarkers } from "./bundle-analysis.js";
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
import { extractTopLevelObjectKeys, normalizePosixPath, uniqueSorted } from "./text.js";
import type {
  StorybookEvidenceItem,
  StorybookExtractedTheme,
  StorybookThemeCandidate,
  StorybookThemeCatalog,
  StorybookThemeDiagnostic,
  StorybookThemeDiagnosticSeverity,
  StorybookTokenAliasReference,
  StorybookTokenGraphEntry
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
const THEME_CONTEXT_PREFIX = "theme";
const FONT_CONTEXT_PREFIX = "font";
const UNKNOWN_VALUE = (reason: string): JsStaticValue => ({ kind: "unknown", reason });

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

const toPathKey = (segments: string[]): string => {
  return segments.join(".");
};

const compareBundlePaths = ({
  left,
  right,
  evidenceThemeBundlePaths
}: {
  left: string;
  right: string;
  evidenceThemeBundlePaths: ReadonlySet<string>;
}): number => {
  const leftIsAsset = left.startsWith("assets/");
  const rightIsAsset = right.startsWith("assets/");
  if (leftIsAsset !== rightIsAsset) {
    return leftIsAsset ? -1 : 1;
  }

  const leftIsEvidenceThemeBundle = evidenceThemeBundlePaths.has(left);
  const rightIsEvidenceThemeBundle = evidenceThemeBundlePaths.has(right);
  if (leftIsEvidenceThemeBundle !== rightIsEvidenceThemeBundle) {
    return leftIsEvidenceThemeBundle ? -1 : 1;
  }

  const leftIsRuntimeBundle =
    path.basename(left).startsWith("iframe-") || path.basename(left).startsWith("index-");
  const rightIsRuntimeBundle =
    path.basename(right).startsWith("iframe-") || path.basename(right).startsWith("index-");
  if (leftIsRuntimeBundle !== rightIsRuntimeBundle) {
    return leftIsRuntimeBundle ? 1 : -1;
  }

  return left.localeCompare(right);
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
  if (!keySet.has("palette") && !keySet.has("colorSchemes")) {
    return 0;
  }
  if (
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
    if (STRONG_THEME_KEYS.has(key)) {
      score += 3;
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
    .filter((candidate) => candidate.score >= 9)
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
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    return undefined;
  }
  const components = parts.slice(0, 3).map((part) => Number(part) / 255);
  if (components.some((component) => Number.isNaN(component))) {
    return undefined;
  }
  const alpha = parts[3] === undefined ? undefined : Number(parts[3]);
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

const addTokenEntry = ({
  target,
  entry
}: {
  target: StorybookTokenGraphEntry[];
  entry: Omit<StorybookTokenGraphEntry, "id">;
}): void => {
  target.push({
    ...entry,
    id: buildStableId("theme-token", {
      themeId: entry.themeId,
      path: entry.path,
      tokenType: entry.tokenType,
      value: entry.value
    })
  });
};

const addFontFamilyToken = ({
  tokens,
  themeId,
  familyName
}: {
  tokens: StorybookTokenGraphEntry[];
  themeId: string;
  familyName: string;
}): StorybookTokenAliasReference => {
  const normalizedFamily = normalizeNameSegment(familyName);
  const path = [FONT_CONTEXT_PREFIX, "family", normalizedFamily];
  if (!tokens.some((token) => toPathKey(token.path) === toPathKey(path))) {
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path,
        tokenType: "fontFamily",
        value: familyName
      }
    });
  }
  return { path };
};

const addFontWeightToken = ({
  tokens,
  themeId,
  weight
}: {
  tokens: StorybookTokenGraphEntry[];
  themeId: string;
  weight: number | string;
}): StorybookTokenAliasReference => {
  const normalizedWeight = normalizeNameSegment(String(weight));
  const path = [FONT_CONTEXT_PREFIX, "weight", normalizedWeight];
  if (!tokens.some((token) => toPathKey(token.path) === toPathKey(path))) {
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path,
        tokenType: "fontWeight",
        value: weight
      }
    });
  }
  return { path };
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

const extractPaletteTokens = ({
  paletteValue,
  themeId,
  tokens,
  diagnostics,
  bundlePath
}: {
  paletteValue: JsStaticValue;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
}): void => {
  if (!isJsStaticObjectValue(paletteValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_PALETTE_UNRESOLVED",
      message: `Theme '${themeId}' contains a non-object palette definition.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "color"]
    });
    return;
  }

  for (const [paletteKey, paletteEntry] of paletteValue.properties.entries()) {
    if (!isJsStaticObjectValue(paletteEntry)) {
      continue;
    }
    for (const [shadeKey, shadeValue] of paletteEntry.properties.entries()) {
      if (!isJsStaticStringValue(shadeValue)) {
        continue;
      }
      const tokenValue = toColorTokenValue(shadeValue.value);
      if (!tokenValue) {
        continue;
      }
      addTokenEntry({
        target: tokens,
        entry: {
          themeId,
          path: [THEME_CONTEXT_PREFIX, themeId, "color", normalizeNameSegment(paletteKey), normalizeNameSegment(shadeKey)],
          tokenType: "color",
          value: tokenValue
        }
      });
    }
  }
};

const extractSpacingTokens = ({
  spacingValue,
  themeId,
  tokens,
  diagnostics,
  bundlePath
}: {
  spacingValue: JsStaticValue | undefined;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
}): void => {
  if (!spacingValue) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_SPACING_MISSING",
      message: `Theme '${themeId}' does not expose an authoritative spacing definition.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "spacing"]
    });
    return;
  }

  if (isJsStaticNumberValue(spacingValue)) {
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "base"],
        tokenType: "dimension",
        value: { value: spacingValue.value, unit: "px" }
      }
    });
    return;
  }

  if (isJsStaticArrayValue(spacingValue)) {
    spacingValue.values.forEach((entry, index) => {
      if (isJsStaticNumberValue(entry)) {
        addTokenEntry({
          target: tokens,
          entry: {
            themeId,
            path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "scale", String(index)],
            tokenType: "dimension",
            value: { value: entry.value, unit: "px" }
          }
        });
        return;
      }
      if (isJsStaticStringValue(entry)) {
        const dimension = parseDimensionString(entry.value);
        if (dimension) {
          addTokenEntry({
            target: tokens,
            entry: {
              themeId,
              path: [THEME_CONTEXT_PREFIX, themeId, "spacing", "scale", String(index)],
              tokenType: "dimension",
              value: dimension
            }
          });
        }
      }
    });
    return;
  }

  pushDiagnostic({
    diagnostics,
    severity: "error",
    code: "MUI_THEME_SPACING_DYNAMIC_UNSUPPORTED",
    message: `Theme '${themeId}' uses a spacing definition that is not statically evaluable.`,
    bundlePath,
    themeId,
    tokenPath: [THEME_CONTEXT_PREFIX, themeId, "spacing"]
  });
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

const extractTypographyTokens = ({
  typographyValue,
  themeId,
  tokens,
  diagnostics,
  bundlePath
}: {
  typographyValue: JsStaticValue | undefined;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
  bundlePath: string;
}): void => {
  if (!typographyValue || !isJsStaticObjectValue(typographyValue)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_TYPOGRAPHY_MISSING",
      message: `Theme '${themeId}' does not expose an authoritative typography object.`,
      bundlePath,
      themeId,
      tokenPath: [THEME_CONTEXT_PREFIX, themeId, "typography"]
    });
    return;
  }

  const defaultFamilyName = getStringProperty(typographyValue, "fontFamily");
  const defaultFamilyAlias = defaultFamilyName
    ? addFontFamilyToken({
        tokens,
        themeId,
        familyName: Array.isArray(parseFontFamily(defaultFamilyName))
          ? (parseFontFamily(defaultFamilyName) as string[])[0] ?? defaultFamilyName
          : (parseFontFamily(defaultFamilyName) as string)
      })
    : undefined;

  const defaultWeightValue = getNumberProperty(typographyValue, "fontWeightRegular");
  const defaultWeightAlias =
    defaultWeightValue !== undefined
      ? addFontWeightToken({
          tokens,
          themeId,
          weight: defaultWeightValue
        })
      : undefined;

  const baseComposite = buildTypographyCompositeValue({
    variantValue: typographyValue,
    ...(defaultFamilyAlias ? { defaultFontFamilyAlias: defaultFamilyAlias } : {}),
    ...(defaultWeightAlias ? { defaultFontWeightAlias: defaultWeightAlias } : {})
  });
  if (baseComposite) {
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path: [THEME_CONTEXT_PREFIX, themeId, "typography", "base"],
        tokenType: "typography",
        value: baseComposite
      }
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
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path: [THEME_CONTEXT_PREFIX, themeId, "typography", normalizeNameSegment(variantName)],
        tokenType: "typography",
        value: composite
      }
    });
  }
};

const extractFontFaceTokens = ({
  componentsValue,
  themeId,
  tokens
}: {
  componentsValue: JsStaticValue | undefined;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
}): void => {
  if (!componentsValue || !isJsStaticObjectValue(componentsValue)) {
    return;
  }
  const muiCssBaseline = componentsValue.properties.get("MuiCssBaseline");
  if (!muiCssBaseline || !isJsStaticObjectValue(muiCssBaseline)) {
    return;
  }
  const styleOverrides = muiCssBaseline.properties.get("styleOverrides");
  if (!styleOverrides) {
    return;
  }

  for (const fontFace of collectFontFaceObjects(styleOverrides)) {
    const fontFamilyValue = fontFace.get("fontFamily");
    const fontWeightValue = fontFace.get("fontWeight");

    if (fontFamilyValue && isJsStaticStringValue(fontFamilyValue)) {
      addFontFamilyToken({
        tokens,
        themeId,
        familyName: fontFamilyValue.value
      });
    }

    if (fontWeightValue && (isJsStaticNumberValue(fontWeightValue) || isJsStaticStringValue(fontWeightValue))) {
      addFontWeightToken({
        tokens,
        themeId,
        weight: isJsStaticNumberValue(fontWeightValue) ? fontWeightValue.value : fontWeightValue.value
      });
    }
  }
};

const extractRadiusTokens = ({
  shapeValue,
  themeId,
  tokens
}: {
  shapeValue: JsStaticValue | undefined;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
}): void => {
  if (!shapeValue || !isJsStaticObjectValue(shapeValue)) {
    return;
  }
  const borderRadius = getNumberProperty(shapeValue, "borderRadius");
  if (borderRadius === undefined) {
    return;
  }
  addTokenEntry({
    target: tokens,
    entry: {
      themeId,
      path: [THEME_CONTEXT_PREFIX, themeId, "radius", "shape", "border-radius"],
      tokenType: "dimension",
      value: { value: borderRadius, unit: "px" }
    }
  });
};

const extractZIndexTokens = ({
  zIndexValue,
  themeId,
  tokens
}: {
  zIndexValue: JsStaticValue | undefined;
  themeId: string;
  tokens: StorybookTokenGraphEntry[];
}): void => {
  if (!zIndexValue || !isJsStaticObjectValue(zIndexValue)) {
    return;
  }
  for (const [key, entryValue] of zIndexValue.properties.entries()) {
    if (!isJsStaticNumberValue(entryValue)) {
      continue;
    }
    addTokenEntry({
      target: tokens,
      entry: {
        themeId,
        path: [THEME_CONTEXT_PREFIX, themeId, "z-index", normalizeNameSegment(key)],
        tokenType: "number",
        value: entryValue.value
      }
    });
  }
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
    if (token.themeId !== themeId || token.path[0] !== THEME_CONTEXT_PREFIX) {
      continue;
    }
    const category = token.path[2];
    if (category) {
      categories.add(category);
    }
  }
  return uniqueSorted(categories);
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
  diagnostics
}: {
  evaluatedTheme: JsStaticValue;
  themeName: string;
  bundlePath: string;
  diagnostics: StorybookThemeDiagnostic[];
}): { themes: StorybookExtractedTheme[]; tokens: StorybookTokenGraphEntry[] } => {
  const tokens: StorybookTokenGraphEntry[] = [];
  const themes: StorybookExtractedTheme[] = [];
  if (!isJsStaticObjectValue(evaluatedTheme)) {
    pushDiagnostic({
      diagnostics,
      severity: "error",
      code: "MUI_THEME_OBJECT_UNRESOLVED",
      message: `Theme candidate '${themeName}' could not be statically evaluated into an object.`,
      bundlePath
    });
    return { themes, tokens };
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
    extractPaletteTokens({
      paletteValue: contextPalette ?? UNKNOWN_VALUE("palette_missing"),
      themeId,
      tokens,
      diagnostics,
      bundlePath
    });
    extractSpacingTokens({
      spacingValue: baseSpacing,
      themeId,
      tokens,
      diagnostics,
      bundlePath
    });
    extractTypographyTokens({
      typographyValue: baseTypography,
      themeId,
      tokens,
      diagnostics,
      bundlePath
    });
    extractFontFaceTokens({
      componentsValue: baseComponents,
      themeId,
      tokens
    });
    extractRadiusTokens({
      shapeValue: baseShape,
      themeId,
      tokens
    });
    extractZIndexTokens({
      zIndexValue: baseZIndex,
      themeId,
      tokens
    });

    const categories = summarizeThemeCategories({
      themeId,
      tokens
    });
    if (!categories.includes("color")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_COLOR_MISSING",
        message: `Theme '${themeId}' does not expose any authoritative color tokens.`,
        bundlePath,
        themeId,
        tokenPath: [THEME_CONTEXT_PREFIX, themeId, "color"]
      });
    }
    if (!categories.includes("typography")) {
      pushDiagnostic({
        diagnostics,
        severity: "error",
        code: "MUI_THEME_FONT_MISSING",
        message: `Theme '${themeId}' does not expose any authoritative font or typography tokens.`,
        bundlePath,
        themeId,
        tokenPath: [THEME_CONTEXT_PREFIX, themeId, "typography"]
      });
    }

    themes.push({
      id: themeId,
      name: themeName,
      context: contextName,
      categories,
      tokenCount: tokens.filter((token) => token.themeId === themeId).length
    });
  }

  return { themes, tokens };
};

const applyCssVariableAliases = ({
  buildDir,
  evidenceItems,
  tokens
}: {
  buildDir: string;
  evidenceItems: StorybookEvidenceItem[];
  tokens: StorybookTokenGraphEntry[];
}): Promise<void> => {
  const cssEvidence = evidenceItems.filter((item) => item.type === "css");
  if (cssEvidence.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    cssEvidence.map(async (item) => {
      const stylesheetPath = item.source.stylesheetPath;
      if (typeof stylesheetPath !== "string") {
        return;
      }
      const cssText = await readFile(path.join(buildDir, stylesheetPath), "utf8");
      const definitions = extractCssCustomPropertyDefinitions(cssText);
      const variableNamesByComparableValue = new Map<string, Set<string>>();
      for (const definition of definitions) {
        const key = toComparableTokenValue(
          toColorTokenValue(definition.value) ?? parseDimensionString(definition.value) ?? definition.value
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
        token.cssVariableNames = uniqueSorted([
          ...(token.cssVariableNames ?? []),
          ...cssVariableNames
        ]);
      }
    })
  ).then(() => undefined);
};

export const buildStorybookThemeCatalog = async ({
  buildDir,
  evidenceItems
}: {
  buildDir: string;
  evidenceItems: StorybookEvidenceItem[];
}): Promise<StorybookThemeCatalog> => {
  const evidenceThemeBundlePaths = new Set(
    evidenceItems
      .filter((item) => item.type === "theme_bundle")
      .map((item) => item.source.bundlePath)
      .filter((bundlePath): bundlePath is string => typeof bundlePath === "string")
      .map((bundlePath) => normalizePosixPath(bundlePath))
  );
  const bundlePathsToProcess = uniqueSorted([
    ...evidenceThemeBundlePaths,
    ...(await readdir(buildDir, { recursive: true }))
      .filter((entry) => typeof entry === "string" && entry.endsWith(".js"))
      .map((entry) => normalizePosixPath(entry))
  ]).sort((left, right) =>
    compareBundlePaths({
      left,
      right,
      evidenceThemeBundlePaths
    })
  );

  const fallbackDiagnostics: StorybookThemeDiagnostic[] = [];
  let selectedExtraction:
    | {
        score: number;
        themes: StorybookExtractedTheme[];
        tokenGraph: StorybookTokenGraphEntry[];
        diagnostics: StorybookThemeDiagnostic[];
      }
    | undefined;

  for (const bundlePath of bundlePathsToProcess) {
    const bundleText = await readFile(path.join(buildDir, bundlePath), "utf8");
    const themeMarkers = extractThemeMarkers(bundleText);
    const candidates = collectMuiThemeCandidates({
      bundlePath,
      bundleText
    }).slice(0, 3);

    if (themeMarkers.length === 0 && candidates.length === 0) {
      continue;
    }

    if (candidates.length === 0) {
      if (evidenceThemeBundlePaths.has(bundlePath)) {
        pushDiagnostic({
          diagnostics: fallbackDiagnostics,
          severity: "warning",
          code: "MUI_THEME_CANDIDATE_MISSING",
          message: `No statically extractable MUI theme object candidate was found in '${bundlePath}'.`,
          bundlePath
        });
      }
      continue;
    }

    const env = createJsEvaluationEnvironment(bundleText);

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
          bundlePath
        });
      }

      const extracted = extractThemeContexts({
        evaluatedTheme,
        themeName: path.basename(bundlePath, path.extname(bundlePath)),
        bundlePath,
        diagnostics: localDiagnostics
      });
      if (extracted.themes.length === 0 || extracted.tokens.length === 0) {
        if (!selectedExtraction && localDiagnostics.length > 0 && evidenceThemeBundlePaths.has(bundlePath)) {
          fallbackDiagnostics.push(...localDiagnostics);
        }
        continue;
      }

      const score = scoreExtractedThemeGroup({
        candidate,
        themes: extracted.themes,
        tokens: extracted.tokens
      });
      if (!selectedExtraction || score > selectedExtraction.score) {
        selectedExtraction = {
          score,
          themes: extracted.themes,
          tokenGraph: extracted.tokens,
          diagnostics: localDiagnostics
        };
      }
    }
  }

  const themes = selectedExtraction?.themes ?? [];
  const tokenGraph = selectedExtraction?.tokenGraph ?? [];
  const diagnostics = selectedExtraction?.diagnostics ?? fallbackDiagnostics;

  if (selectedExtraction) {
    await applyCssVariableAliases({
      buildDir,
      evidenceItems,
      tokens: tokenGraph
    });
  }

  return {
    themes: themes
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((theme) => ({
        ...theme,
        categories: uniqueSorted(theme.categories),
        tokenCount: tokenGraph.filter((token) => token.themeId === theme.id).length
      })),
    tokenGraph: tokenGraph.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics: diagnostics.sort((left, right) => {
      const bySeverity = left.severity.localeCompare(right.severity);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      const byCode = left.code.localeCompare(right.code);
      if (byCode !== 0) {
        return byCode;
      }
      return left.message.localeCompare(right.message);
    })
  };
};
