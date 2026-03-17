import { readFileSync } from "node:fs";
import type {
  DesignTokenTypographyScale,
  DesignTokenTypographyVariant,
  DesignTokenTypographyVariantName,
  DesignTokens
} from "./types.js";
import { DESIGN_TYPOGRAPHY_VARIANTS, completeTypographyScale } from "./typography-tokens.js";

interface SparkasseTokenValue {
  $value?: unknown;
}

interface SparkasseTokenSchema {
  color?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  borderRadius?: Record<string, unknown>;
}

const DEFAULT_SPARKASSE_FONT_FAMILY = "'sparkasseRegular', 'sparkasseRegular Fallback', Roboto, Arial, sans-serif";

const TYPOGRAPHY_SIZE_FALLBACK_PATHS: Record<DesignTokenTypographyVariantName, string[][]> = {
  h1: [["typography", "fontSize", "2xl"]],
  h2: [["typography", "fontSize", "xl"]],
  h3: [["typography", "fontSize", "lg"]],
  h4: [["typography", "fontSize", "md"]],
  h5: [["typography", "fontSize", "md"]],
  h6: [["typography", "fontSize", "sm"]],
  subtitle1: [["typography", "fontSize", "md"]],
  subtitle2: [["typography", "fontSize", "sm"]],
  body1: [["typography", "fontSize", "md"]],
  body2: [["typography", "fontSize", "sm"]],
  button: [["typography", "fontSize", "md"]],
  caption: [["typography", "fontSize", "xs"]],
  overline: [["typography", "fontSize", "xs"]]
};

const asObject = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const getByPath = (source: unknown, path: string[]): unknown => {
  let cursor: unknown = source;
  for (const segment of path) {
    const objectCursor = asObject(cursor);
    if (!objectCursor || !(segment in objectCursor)) {
      return undefined;
    }
    cursor = objectCursor[segment];
  }
  return cursor;
};

const readRawTokenValue = (source: unknown, path: string[]): unknown => {
  const token = getByPath(source, path) as SparkasseTokenValue | undefined;
  return token?.$value;
};

const readColor = (source: unknown, path: string[]): string | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return raw.trim();
};

const readFirstColor = (source: unknown, paths: string[][]): string | undefined => {
  for (const path of paths) {
    const color = readColor(source, path);
    if (color) {
      return color;
    }
  }
  return undefined;
};

const readNumber = (source: unknown, path: string[]): number | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[^0-9.+-]/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const readFirstNumber = (source: unknown, paths: string[][]): number | undefined => {
  for (const path of paths) {
    const value = readNumber(source, path);
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
};

const readFontFamily = (source: unknown, path: string[]): string | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return raw.trim();
};

const readFirstFontFamily = (source: unknown, paths: string[][]): string | undefined => {
  for (const path of paths) {
    const value = readFontFamily(source, path);
    if (value) {
      return value;
    }
  }
  return undefined;
};

const readString = (source: unknown, path: string[]): string | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return raw.trim();
};

const normalizeFontFamily = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return DEFAULT_SPARKASSE_FONT_FAMILY;
  }
  if (normalized.includes("Roboto") || normalized.includes("Arial") || normalized.includes("sans-serif")) {
    return normalized;
  }
  return `${normalized}, Roboto, Arial, sans-serif`;
};

const readLetterSpacingEm = (source: unknown, path: string[]): number | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.endsWith("em")) {
      const parsed = Number(trimmed.slice(0, -2));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const readTextTransform = (source: unknown, path: string[]): DesignTokenTypographyVariant["textTransform"] | undefined => {
  const raw = readString(source, path)?.toLowerCase();
  if (raw === "none" || raw === "capitalize" || raw === "uppercase" || raw === "lowercase") {
    return raw;
  }
  return undefined;
};

const toHexWithAlpha = (hex: string, alpha: number): string => {
  const normalized = hex.replace("#", "");
  const colorPayload = normalized.length >= 6 ? normalized.slice(0, 6) : normalized;
  if (!/^[0-9a-f]{6}$/i.test(colorPayload)) {
    return hex;
  }
  const alphaHex = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `#${colorPayload}${alphaHex}`;
};

const buildActionPalette = ({
  primaryColor,
  textColor
}: {
  primaryColor: string;
  textColor: string;
}): DesignTokens["palette"]["action"] => {
  return {
    active: toHexWithAlpha(textColor, 0.54),
    hover: toHexWithAlpha(primaryColor, 0.04),
    selected: toHexWithAlpha(primaryColor, 0.08),
    disabled: toHexWithAlpha(textColor, 0.26),
    disabledBackground: toHexWithAlpha(textColor, 0.12),
    focus: toHexWithAlpha(primaryColor, 0.12)
  };
};

const cloneTypographyScale = (scale: DesignTokenTypographyScale): DesignTokenTypographyScale => {
  return Object.fromEntries(
    DESIGN_TYPOGRAPHY_VARIANTS.map((variantName) => [variantName, { ...scale[variantName] }])
  ) as DesignTokenTypographyScale;
};

const defaultSparkasseTypography = completeTypographyScale({
  fontFamily: DEFAULT_SPARKASSE_FONT_FAMILY,
  headingSize: 24,
  bodySize: 16
});

const defaultSparkasseTokens: DesignTokens = {
  palette: {
    primary: "#EE0000",
    secondary: "#43A047",
    background: "#FAFAFA",
    text: "#222222",
    success: "#43A047",
    warning: "#D97706",
    error: "#DC2626",
    info: "#0288D1",
    divider: "#2222221f",
    action: {
      active: "#2222228a",
      hover: "#EE00000a",
      selected: "#EE000014",
      disabled: "#22222242",
      disabledBackground: "#2222221f",
      focus: "#EE00001f"
    }
  },
  borderRadius: 12,
  spacingBase: 8,
  fontFamily: DEFAULT_SPARKASSE_FONT_FAMILY,
  headingSize: 24,
  bodySize: 16,
  typography: defaultSparkasseTypography
};

let cachedSparkasseTokens: DesignTokens | null = null;

const readTypographyVariantFromSchema = ({
  source,
  variantName,
  fallbackFontFamily
}: {
  source: SparkasseTokenSchema;
  variantName: DesignTokenTypographyVariantName;
  fallbackFontFamily: string;
}): Partial<DesignTokenTypographyVariant> | undefined => {
  const roots = [
    ["typography", "variants", variantName],
    ["typography", "variant", variantName],
    ["typography", "typeScale", variantName],
    ["typography", variantName]
  ];

  for (const root of roots) {
    const fontSizePx = readFirstNumber(source, [[...root, "fontSizePx"], [...root, "fontSize"], [...root, "size"]]);
    const fontWeight = readFirstNumber(source, [[...root, "fontWeight"], [...root, "weight"]]);
    const lineHeightPx = readFirstNumber(source, [[...root, "lineHeightPx"], [...root, "lineHeight"]]);
    const fontFamily = readFirstFontFamily(source, [[...root, "fontFamily"], [...root, "family"]]);
    const letterSpacingEm = readLetterSpacingEm(source, [...root, "letterSpacing"]);
    const textTransform = readTextTransform(source, [...root, "textTransform"]);

    if (
      fontSizePx === undefined &&
      fontWeight === undefined &&
      lineHeightPx === undefined &&
      fontFamily === undefined &&
      letterSpacingEm === undefined &&
      textTransform === undefined
    ) {
      continue;
    }

    return {
      ...(typeof fontSizePx === "number" ? { fontSizePx } : {}),
      ...(typeof fontWeight === "number" ? { fontWeight } : {}),
      ...(typeof lineHeightPx === "number" ? { lineHeightPx } : {}),
      fontFamily: normalizeFontFamily(fontFamily ?? fallbackFontFamily),
      ...(typeof letterSpacingEm === "number" ? { letterSpacingEm } : {}),
      ...(textTransform ? { textTransform } : {})
    };
  }

  return undefined;
};

const loadSparkasseTokensFromSchema = (): DesignTokens => {
  const tokensFile = process.env.BRAND_TOKENS_FILE ?? "/workspace-config/sparkasse-design-tokens.json";

  try {
    const rawFile = readFileSync(tokensFile, "utf-8");
    const parsed = JSON.parse(rawFile) as SparkasseTokenSchema;
    const primary = readFirstColor(parsed, [["color", "brand", "primary"]]) ?? defaultSparkasseTokens.palette.primary;
    const text = readFirstColor(parsed, [["color", "neutral", "gray-900"]]) ?? defaultSparkasseTokens.palette.text;
    const success =
      readFirstColor(parsed, [
        ["color", "system", "success"],
        ["color", "system", "success-alt"],
        ["color", "semantic", "success"]
      ]) ?? defaultSparkasseTokens.palette.success;
    const warning =
      readFirstColor(parsed, [
        ["color", "system", "warning"],
        ["color", "system", "warn"],
        ["color", "semantic", "warning"]
      ]) ?? defaultSparkasseTokens.palette.warning;
    const error =
      readFirstColor(parsed, [
        ["color", "system", "error"],
        ["color", "semantic", "error"],
        ["color", "feedback", "error"]
      ]) ?? defaultSparkasseTokens.palette.error;
    const info =
      readFirstColor(parsed, [
        ["color", "system", "info"],
        ["color", "semantic", "info"],
        ["color", "feedback", "info"]
      ]) ?? defaultSparkasseTokens.palette.info;
    const divider =
      readFirstColor(parsed, [
        ["color", "neutral", "gray-200"],
        ["color", "neutral", "gray-300"],
        ["color", "border", "default"]
      ]) ?? toHexWithAlpha(text, 0.12);
    const secondary =
      readFirstColor(parsed, [
        ["color", "system", "success-alt"],
        ["color", "system", "success"]
      ]) ?? defaultSparkasseTokens.palette.secondary;

    const fontFamily = normalizeFontFamily(
      readFirstFontFamily(parsed, [
        ["typography", "fontFamily", "regular"],
        ["typography", "fontFamily", "body"],
        ["typography", "fontFamily", "heading"]
      ]) ?? defaultSparkasseTokens.fontFamily
    );
    const headingSize = readNumber(parsed, ["typography", "fontSize", "2xl"]) ?? defaultSparkasseTokens.headingSize;
    const bodySize = readNumber(parsed, ["typography", "fontSize", "md"]) ?? defaultSparkasseTokens.bodySize;

    const typographyPartial = Object.fromEntries(
      DESIGN_TYPOGRAPHY_VARIANTS.flatMap((variantName) => {
        const explicitVariant = readTypographyVariantFromSchema({
          source: parsed,
          variantName,
          fallbackFontFamily: fontFamily
        });
        const fallbackFontSizePx = readFirstNumber(parsed, TYPOGRAPHY_SIZE_FALLBACK_PATHS[variantName]);
        if (!explicitVariant && fallbackFontSizePx === undefined) {
          return [];
        }
        return [
          [
            variantName,
            {
              ...explicitVariant,
              ...(typeof fallbackFontSizePx === "number" && explicitVariant?.fontSizePx === undefined
                ? { fontSizePx: fallbackFontSizePx }
                : {})
            }
          ]
        ];
      })
    ) as Partial<Record<DesignTokenTypographyVariantName, Partial<DesignTokenTypographyVariant>>>;

    const typography = completeTypographyScale({
      partialScale: typographyPartial,
      fontFamily,
      headingSize,
      bodySize
    });

    return {
      palette: {
        primary,
        secondary,
        background: readFirstColor(parsed, [["color", "neutral", "gray-50"]]) ?? defaultSparkasseTokens.palette.background,
        text,
        success,
        warning,
        error,
        info,
        divider,
        action: buildActionPalette({
          primaryColor: primary,
          textColor: text
        })
      },
      borderRadius: readNumber(parsed, ["borderRadius", "lg"]) ?? defaultSparkasseTokens.borderRadius,
      spacingBase: readNumber(parsed, ["spacing", "xs"]) ?? defaultSparkasseTokens.spacingBase,
      fontFamily,
      headingSize: typography.h1.fontSizePx,
      bodySize: typography.body1.fontSizePx,
      typography
    };
  } catch {
    return {
      ...defaultSparkasseTokens,
      typography: cloneTypographyScale(defaultSparkasseTokens.typography)
    };
  }
};

export const getSparkasseThemeDefaults = (): DesignTokens => {
  if (cachedSparkasseTokens) {
    return cachedSparkasseTokens;
  }

  cachedSparkasseTokens = loadSparkasseTokensFromSchema();
  return cachedSparkasseTokens;
};

export const applySparkasseThemeDefaults = (tokens: DesignTokens): DesignTokens => {
  const sparkasseDefaults = getSparkasseThemeDefaults();

  return {
    ...tokens,
    palette: {
      primary: sparkasseDefaults.palette.primary,
      secondary:
        tokens.palette.secondary && tokens.palette.secondary !== tokens.palette.primary
          ? tokens.palette.secondary
          : sparkasseDefaults.palette.secondary,
      background: sparkasseDefaults.palette.background,
      text: sparkasseDefaults.palette.text,
      success: sparkasseDefaults.palette.success,
      warning: sparkasseDefaults.palette.warning,
      error: sparkasseDefaults.palette.error,
      info: sparkasseDefaults.palette.info,
      divider: sparkasseDefaults.palette.divider,
      action: { ...sparkasseDefaults.palette.action }
    },
    borderRadius: sparkasseDefaults.borderRadius,
    spacingBase: sparkasseDefaults.spacingBase,
    fontFamily: normalizeFontFamily(sparkasseDefaults.fontFamily),
    headingSize: sparkasseDefaults.typography.h1.fontSizePx,
    bodySize: sparkasseDefaults.typography.body1.fontSizePx,
    typography: cloneTypographyScale(sparkasseDefaults.typography)
  };
};
