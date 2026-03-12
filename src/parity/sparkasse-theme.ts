import { readFileSync } from "node:fs";
import type { DesignTokens } from "./types.js";

interface SparkasseTokenValue {
  $value?: unknown;
}

interface SparkasseTokenSchema {
  color?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  borderRadius?: Record<string, unknown>;
}

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

const readNumber = (source: unknown, path: string[]): number | undefined => {
  const raw = readRawTokenValue(source, path);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
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

const defaultSparkasseTokens: DesignTokens = {
  palette: {
    primary: "#EE0000",
    secondary: "#43A047",
    background: "#FAFAFA",
    text: "#222222"
  },
  borderRadius: 12,
  spacingBase: 8,
  fontFamily: "'sparkasseRegular', 'sparkasseRegular Fallback', Roboto, Arial, sans-serif",
  headingSize: 24,
  bodySize: 16
};

let cachedSparkasseTokens: DesignTokens | null = null;

const loadSparkasseTokensFromSchema = (): DesignTokens => {
  const tokensFile =
    process.env.BRAND_TOKENS_FILE ?? "/workspace-config/sparkasse-design-tokens.json";

  try {
    const rawFile = readFileSync(tokensFile, "utf-8");
    const parsed = JSON.parse(rawFile) as SparkasseTokenSchema;

    return {
      palette: {
        primary: readColor(parsed, ["color", "brand", "primary"]) ?? defaultSparkasseTokens.palette.primary,
        secondary:
          readColor(parsed, ["color", "system", "success-alt"]) ??
          readColor(parsed, ["color", "system", "success"]) ??
          defaultSparkasseTokens.palette.secondary,
        background: readColor(parsed, ["color", "neutral", "gray-50"]) ?? defaultSparkasseTokens.palette.background,
        text: readColor(parsed, ["color", "neutral", "gray-900"]) ?? defaultSparkasseTokens.palette.text
      },
      borderRadius: readNumber(parsed, ["borderRadius", "lg"]) ?? defaultSparkasseTokens.borderRadius,
      spacingBase: readNumber(parsed, ["spacing", "xs"]) ?? defaultSparkasseTokens.spacingBase,
      fontFamily:
        readFontFamily(parsed, ["typography", "fontFamily", "regular"]) ?? defaultSparkasseTokens.fontFamily,
      headingSize: readNumber(parsed, ["typography", "fontSize", "2xl"]) ?? defaultSparkasseTokens.headingSize,
      bodySize: readNumber(parsed, ["typography", "fontSize", "md"]) ?? defaultSparkasseTokens.bodySize
    };
  } catch {
    return defaultSparkasseTokens;
  }
};

export const getSparkasseThemeDefaults = (): DesignTokens => {
  if (cachedSparkasseTokens) {
    return cachedSparkasseTokens;
  }

  cachedSparkasseTokens = loadSparkasseTokensFromSchema();
  return cachedSparkasseTokens;
};

const normalizeFontFamily = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return defaultSparkasseTokens.fontFamily;
  }
  if (normalized.includes("Roboto") || normalized.includes("Arial") || normalized.includes("sans-serif")) {
    return normalized;
  }
  return `${normalized}, Roboto, Arial, sans-serif`;
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
      text: sparkasseDefaults.palette.text
    },
    borderRadius: sparkasseDefaults.borderRadius,
    spacingBase: sparkasseDefaults.spacingBase,
    fontFamily: normalizeFontFamily(sparkasseDefaults.fontFamily),
    headingSize: sparkasseDefaults.headingSize,
    bodySize: sparkasseDefaults.bodySize
  };
};
