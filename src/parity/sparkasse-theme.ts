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
    const primary =
      readFirstColor(parsed, [["color", "brand", "primary"]]) ?? defaultSparkasseTokens.palette.primary;
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
    headingSize: sparkasseDefaults.headingSize,
    bodySize: sparkasseDefaults.bodySize
  };
};
