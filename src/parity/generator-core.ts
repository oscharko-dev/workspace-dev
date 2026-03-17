import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignIR,
  DesignTokenTypographyVariantName,
  GenerationMetrics,
  GeneratedFile,
  LlmCodegenMode,
  ResponsiveBreakpoint,
  ScreenResponsiveLayoutOverride,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  ScreenElementIR,
  ScreenIR,
  VariantStateStyle
} from "./types.js";
import { BUILTIN_ICON_FALLBACK_CATALOG, ICON_FALLBACK_MAP_VERSION } from "./icon-fallback-catalog.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";
import { WorkflowError } from "./workflow-error.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import type { WorkspaceRouterMode } from "../contracts/index.js";

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  iconMapFilePath?: string;
  imageAssetMap?: Record<string, string>;
  generationLocale?: string;
  routerMode?: WorkspaceRouterMode;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  onLog: (message: string) => void;
}

interface RejectedScreenEnhancement {
  screenName: string;
  reason: string;
}

interface GenerateArtifactsResult {
  generatedPaths: string[];
  generationMetrics: GenerationMetrics;
  themeApplied: boolean;
  screenApplied: number;
  screenTotal: number;
  screenRejected: RejectedScreenEnhancement[];
  llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }>;
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  mappingDiagnostics: {
    missingMappingCount: number;
    contractMismatchCount: number;
    disabledMappingCount: number;
  };
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
}

interface VirtualParent {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  name?: string | undefined;
  fillColor?: string | undefined;
  fillGradient?: string | undefined;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE" | undefined;
}

interface AccessibilityWarning {
  code: "W_A11Y_LOW_CONTRAST";
  screenId: string;
  screenName: string;
  nodeId: string;
  nodeName: string;
  message: string;
  foreground: string;
  background: string;
  contrastRatio: number;
}

interface ScreenArtifactIdentity {
  componentName: string;
  filePath: string;
  routePath: string;
}

const literal = (value: string): string => JSON.stringify(value);

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const normalizeOpacityForSx = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = clamp(value, 0, 1);
  return normalized < 1 ? normalized : undefined;
};

const normalizeFontFamily = (rawFamily: string | undefined): string | undefined => {
  if (!rawFamily || !rawFamily.trim()) {
    return undefined;
  }
  const normalized = rawFamily.trim();
  if (/roboto|arial|sans-serif/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}, Roboto, Arial, sans-serif`;
};

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const toComponentName = (rawName: string): string => {
  const safe = sanitizeFileName(rawName);
  const parts = safe.split(/[_-]+/).filter((part) => part.length > 0);
  const pascal = parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return pascal.length > 0 ? pascal : "Screen";
};

const toScreenIdSuffix = (screenId: string): string => {
  const compact = screenId.replace(/[^a-zA-Z0-9]+/g, "");
  if (compact.length >= 6) {
    return compact.slice(-6);
  }
  if (compact.length > 0) {
    return compact;
  }
  return "v2";
};

const toUniqueScreenStem = ({
  baseStem,
  suffix
}: {
  baseStem: string;
  suffix: string;
}): string => {
  return `${baseStem}_${suffix}`;
};

const buildScreenArtifactIdentities = (screens: ScreenIR[]): Map<string, ScreenArtifactIdentity> => {
  const byScreenId = new Map<string, ScreenArtifactIdentity>();
  const usedComponentNames = new Set<string>();
  const usedFilePaths = new Set<string>();
  const usedRoutePaths = new Set<string>();

  for (const screen of screens) {
    const baseRoute = `/${sanitizeFileName(screen.name).toLowerCase() || "screen"}`;
    const baseComponent = toComponentName(screen.name);
    const baseStem = sanitizeFileName(screen.name) || "Screen";
    const suffix = toScreenIdSuffix(screen.id);

    let componentName = baseComponent;
    let filePath = toDeterministicScreenPath(baseStem);
    let routePath = baseRoute;
    let attempt = 0;

    while (
      usedComponentNames.has(componentName.toLowerCase()) ||
      usedFilePaths.has(filePath.toLowerCase()) ||
      usedRoutePaths.has(routePath.toLowerCase())
    ) {
      attempt += 1;
      const attemptSuffix = attempt === 1 ? suffix : `${suffix}${attempt + 1}`;
      const nextStem = toUniqueScreenStem({
        baseStem,
        suffix: attemptSuffix
      });
      componentName = toComponentName(nextStem);
      filePath = toDeterministicScreenPath(nextStem);
      routePath = `${baseRoute}-${attemptSuffix.toLowerCase()}`;
    }

    usedComponentNames.add(componentName.toLowerCase());
    usedFilePaths.add(filePath.toLowerCase());
    usedRoutePaths.add(routePath.toLowerCase());
    byScreenId.set(screen.id, {
      componentName,
      filePath,
      routePath
    });
  }

  return byScreenId;
};

const toPxLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return literal(`${Math.round(value)}px`);
};

const RESPONSIVE_WIDTH_RATIO_MIN = 0.001;
const RESPONSIVE_WIDTH_RATIO_MAX = 1.2;
const RESPONSIVE_FULL_WIDTH_EPSILON = 0.02;

const normalizeResponsiveWidthRatio = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = clamp(value, RESPONSIVE_WIDTH_RATIO_MIN, RESPONSIVE_WIDTH_RATIO_MAX);
  return Math.round(normalized * 1000) / 1000;
};

const toPercentLiteralFromRatio = (ratio: number | undefined): string | undefined => {
  const normalized = normalizeResponsiveWidthRatio(ratio);
  if (normalized === undefined) {
    return undefined;
  }
  if (Math.abs(1 - normalized) <= RESPONSIVE_FULL_WIDTH_EPSILON) {
    return literal("100%");
  }
  const percent = Math.round(normalized * 100000) / 1000;
  const percentString = Number.isInteger(percent) ? String(percent) : percent.toString();
  return literal(`${percentString}%`);
};

const DEFAULT_SPACING_BASE = 8;
const REM_BASE = 16;
const DEFAULT_ROUTER_MODE: WorkspaceRouterMode = "browser";

const normalizeSpacingBase = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SPACING_BASE;
  }
  return value;
};

const toSpacingUnitValue = ({
  value,
  spacingBase
}: {
  value: number | undefined;
  spacingBase: number;
}): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.round((value / normalizeSpacingBase(spacingBase)) * 1000) / 1000;
  if (normalized === 0 && value > 0) {
    return 0.125;
  }
  return normalized;
};

const toSpacingEdgeUnit = ({
  value,
  spacingBase
}: {
  value: number | undefined;
  spacingBase: number;
}): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return toSpacingUnitValue({ value, spacingBase });
};

const toBoxSpacingSxEntries = ({
  values,
  spacingBase,
  allKey,
  xKey,
  yKey,
  topKey,
  rightKey,
  bottomKey,
  leftKey
}: {
  values:
    | {
        top: number;
        right: number;
        bottom: number;
        left: number;
      }
    | undefined;
  spacingBase: number;
  allKey: string;
  xKey: string;
  yKey: string;
  topKey: string;
  rightKey: string;
  bottomKey: string;
  leftKey: string;
}): Array<[string, string | number | undefined]> => {
  if (!values) {
    return [];
  }

  const top = toSpacingEdgeUnit({ value: values.top, spacingBase });
  const right = toSpacingEdgeUnit({ value: values.right, spacingBase });
  const bottom = toSpacingEdgeUnit({ value: values.bottom, spacingBase });
  const left = toSpacingEdgeUnit({ value: values.left, spacingBase });

  if (top !== undefined && top === right && right === bottom && bottom === left) {
    return [[allKey, top]];
  }

  if (top === bottom && right === left) {
    return [
      [yKey, top],
      [xKey, right]
    ];
  }

  return [
    [topKey, top],
    [rightKey, right],
    [bottomKey, bottom],
    [leftKey, left]
  ];
};

const toThemeBorderRadiusValue = ({
  radiusPx,
  tokens
}: {
  radiusPx: number | undefined;
  tokens: DesignTokens | undefined;
}): string | number | undefined => {
  if (typeof radiusPx !== "number" || !Number.isFinite(radiusPx) || radiusPx <= 0) {
    return undefined;
  }

  const tokenBorderRadius = tokens?.borderRadius;
  if (typeof tokenBorderRadius !== "number" || !Number.isFinite(tokenBorderRadius) || tokenBorderRadius <= 0) {
    return toPxLiteral(radiusPx);
  }

  const normalized = Math.round((radiusPx / tokenBorderRadius) * 1000) / 1000;
  if (normalized === 0) {
    return 0.125;
  }
  return normalized;
};

const toRemLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rem = Math.round((value / REM_BASE) * 10000) / 10000;
  const remString = Number.isInteger(rem) ? String(rem) : rem.toString();
  return literal(`${remString}rem`);
};

const toEmLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const em = Math.round(value * 10000) / 10000;
  const emString = Number.isInteger(em) ? String(em) : em.toString();
  return literal(`${emString}em`);
};

const toLetterSpacingEm = ({
  letterSpacingPx,
  fontSizePx
}: {
  letterSpacingPx: number | undefined;
  fontSizePx: number | undefined;
}): number | undefined => {
  if (
    typeof letterSpacingPx !== "number" ||
    !Number.isFinite(letterSpacingPx) ||
    typeof fontSizePx !== "number" ||
    !Number.isFinite(fontSizePx) ||
    fontSizePx <= 0
  ) {
    return undefined;
  }
  return Math.round((letterSpacingPx / fontSizePx) * 10000) / 10000;
};

const normalizeHexColor = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const payload = match[1]?.toLowerCase();
  if (!payload) {
    return undefined;
  }
  if (payload.length === 3) {
    return `#${payload
      .split("")
      .map((chunk) => `${chunk}${chunk}`)
      .join("")}`;
  }
  return `#${payload}`;
};

const toThemePaletteLiteral = ({
  color,
  tokens
}: {
  color: string | undefined;
  tokens: DesignTokens | undefined;
}): string | undefined => {
  if (!tokens) {
    return undefined;
  }
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) {
    return undefined;
  }

  const exactMatches: Array<[string, string | undefined]> = [
    ["primary.main", tokens.palette.primary],
    ["secondary.main", tokens.palette.secondary],
    ["success.main", tokens.palette.success],
    ["warning.main", tokens.palette.warning],
    ["error.main", tokens.palette.error],
    ["info.main", tokens.palette.info],
    ["background.default", tokens.palette.background],
    ["text.primary", tokens.palette.text],
    ["divider", tokens.palette.divider]
  ];

  for (const [tokenPath, tokenColor] of exactMatches) {
    if (normalizeHexColor(tokenColor) === normalizedColor) {
      return tokenPath;
    }
  }
  return undefined;
};

const toThemeColorLiteral = ({
  color,
  tokens
}: {
  color: string | undefined;
  tokens: DesignTokens | undefined;
}): string | undefined => {
  if (!color) {
    return undefined;
  }
  const trimmed = color.trim();
  if (!trimmed) {
    return undefined;
  }
  const mapped = toThemePaletteLiteral({ color: trimmed, tokens });
  return literal(mapped ?? trimmed);
};

type ButtonVariant = "contained" | "outlined" | "text";
type ButtonSize = "small" | "medium" | "large";
type ValidationFieldType = "email" | "password" | "tel" | "number" | "date" | "url" | "search";
type HeadingComponent = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type LandmarkRole = "navigation";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BUTTON_FULL_WIDTH_EPSILON = 0.02;
const BUTTON_VISIBLE_ALPHA_THRESHOLD = 0.08;
const BUTTON_DISABLED_OPACITY_THRESHOLD = 0.55;
const BUTTON_NEUTRAL_CHANNEL_DELTA_MAX = 24;
const BUTTON_NEAR_WHITE_MIN_CHANNEL = 245;
const FIELD_ERROR_RED_MIN_CHANNEL = 150;
const FIELD_ERROR_RED_DELTA_MIN = 32;
const WCAG_AA_NORMAL_TEXT_CONTRAST_MIN = 4.5;
const DARK_MODE_BACKGROUND_DEFAULT = "#121212";
const DARK_MODE_BACKGROUND_PAPER = "#1e1e1e";
const DARK_MODE_TEXT_PRIMARY = "#f5f7fb";
const LIGHTEN_TO_WHITE_STEP = 0.08;
const LIGHTEN_TO_WHITE_MAX_STEPS = 11;

const hasVisibleGradient = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
};

const toRgbaColor = (value: string | undefined): RgbaColor | undefined => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return undefined;
  }
  const payload = normalized.slice(1);
  if (payload.length !== 6 && payload.length !== 8) {
    return undefined;
  }
  const r = Number.parseInt(payload.slice(0, 2), 16);
  const g = Number.parseInt(payload.slice(2, 4), 16);
  const b = Number.parseInt(payload.slice(4, 6), 16);
  const alphaHex = payload.length === 8 ? payload.slice(6, 8) : "ff";
  const alphaRaw = Number.parseInt(alphaHex, 16);
  if ([r, g, b, alphaRaw].some((entry) => !Number.isFinite(entry))) {
    return undefined;
  }
  return {
    r,
    g,
    b,
    a: Math.round((alphaRaw / 255) * 1000) / 1000
  };
};

const isVisibleColor = (color: RgbaColor | undefined, minAlpha = BUTTON_VISIBLE_ALPHA_THRESHOLD): boolean => {
  if (!color) {
    return false;
  }
  return color.a >= minAlpha;
};

const isNearWhiteColor = (color: RgbaColor | undefined): boolean => {
  if (!isVisibleColor(color)) {
    return false;
  }
  if (!color) {
    return false;
  }
  const channelDelta = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  return channelDelta <= BUTTON_NEUTRAL_CHANNEL_DELTA_MAX && color.r >= BUTTON_NEAR_WHITE_MIN_CHANNEL && color.g >= BUTTON_NEAR_WHITE_MIN_CHANNEL && color.b >= BUTTON_NEAR_WHITE_MIN_CHANNEL;
};

const isNeutralGrayColor = (color: RgbaColor | undefined): boolean => {
  if (!isVisibleColor(color, 0.2)) {
    return false;
  }
  if (!color) {
    return false;
  }
  const channelDelta = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  return channelDelta <= BUTTON_NEUTRAL_CHANNEL_DELTA_MAX;
};

const isLikelyErrorRedColor = (color: RgbaColor | undefined): boolean => {
  if (!isVisibleColor(color, 0.2)) {
    return false;
  }
  if (!color) {
    return false;
  }
  const redOverGreen = color.r - color.g;
  const redOverBlue = color.r - color.b;
  return color.r >= FIELD_ERROR_RED_MIN_CHANNEL && redOverGreen >= FIELD_ERROR_RED_DELTA_MIN && redOverBlue >= FIELD_ERROR_RED_DELTA_MIN;
};

const toRelativeLuminance = (color: RgbaColor): number => {
  const toLinear = (channel: number): number => {
    const normalized = clamp(channel / 255, 0, 1);
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const toContrastRatio = (foreground: RgbaColor, background: RgbaColor): number => {
  const foregroundLuminance = toRelativeLuminance(foreground);
  const backgroundLuminance = toRelativeLuminance(background);
  const brighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (brighter + 0.05) / (darker + 0.05);
};

const toOpaqueHex = (value: string | undefined): string | undefined => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return undefined;
  }
  return `#${normalized.slice(1, 7)}`;
};

const toHexChannel = (value: number): string => {
  return clamp(Math.round(value), 0, 255)
    .toString(16)
    .padStart(2, "0");
};

const toRgbHex = (color: { r: number; g: number; b: number }): string => {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
};

const mixHexColors = ({
  left,
  right,
  amount
}: {
  left: string;
  right: string;
  amount: number;
}): string => {
  const leftColor = toRgbaColor(toOpaqueHex(left));
  const rightColor = toRgbaColor(toOpaqueHex(right));
  if (!leftColor || !rightColor) {
    return left;
  }
  const normalizedAmount = clamp(amount, 0, 1);
  const mixChannel = (from: number, to: number): number => from + (to - from) * normalizedAmount;
  return toRgbHex({
    r: mixChannel(leftColor.r, rightColor.r),
    g: mixChannel(leftColor.g, rightColor.g),
    b: mixChannel(leftColor.b, rightColor.b)
  });
};

const toHexWithAlpha = (hex: string, alpha: number): string => {
  const normalized = toOpaqueHex(hex);
  if (!normalized) {
    return hex;
  }
  const alphaHex = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `${normalized}${alphaHex}`;
};

const ensureContrastAgainstBackground = ({
  color,
  background,
  minContrast = WCAG_AA_NORMAL_TEXT_CONTRAST_MIN
}: {
  color: string;
  background: string;
  minContrast?: number;
}): string => {
  const baseColor = toOpaqueHex(color);
  const baseBackground = toOpaqueHex(background);
  const backgroundRgba = toRgbaColor(baseBackground);
  if (!baseColor || !baseBackground || !backgroundRgba) {
    return color;
  }

  for (let step = 0; step <= LIGHTEN_TO_WHITE_MAX_STEPS; step += 1) {
    const candidate =
      step === 0 ? baseColor : mixHexColors({ left: baseColor, right: "#ffffff", amount: step * LIGHTEN_TO_WHITE_STEP });
    const candidateRgba = toRgbaColor(candidate);
    if (candidateRgba && toContrastRatio(candidateRgba, backgroundRgba) >= minContrast) {
      return candidate;
    }
  }

  return mixHexColors({ left: baseColor, right: "#ffffff", amount: LIGHTEN_TO_WHITE_MAX_STEPS * LIGHTEN_TO_WHITE_STEP });
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

interface ResolvedThemePalette {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  background: {
    default: string;
    paper: string;
  };
  text: {
    primary: string;
  };
  divider: string;
  action: DesignTokens["palette"]["action"];
}

const toLightThemePalette = (tokens: DesignTokens): ResolvedThemePalette => {
  return {
    primary: tokens.palette.primary,
    secondary: tokens.palette.secondary,
    success: tokens.palette.success,
    warning: tokens.palette.warning,
    error: tokens.palette.error,
    info: tokens.palette.info,
    background: {
      default: tokens.palette.background,
      paper: tokens.palette.background
    },
    text: {
      primary: tokens.palette.text
    },
    divider: tokens.palette.divider,
    action: tokens.palette.action
  };
};

const toDarkThemePalette = (tokens: DesignTokens): ResolvedThemePalette => {
  const adjustedPrimary = ensureContrastAgainstBackground({
    color: tokens.palette.primary,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });
  const adjustedSecondary = ensureContrastAgainstBackground({
    color: tokens.palette.secondary,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });
  const adjustedSuccess = ensureContrastAgainstBackground({
    color: tokens.palette.success,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });
  const adjustedWarning = ensureContrastAgainstBackground({
    color: tokens.palette.warning,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });
  const adjustedError = ensureContrastAgainstBackground({
    color: tokens.palette.error,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });
  const adjustedInfo = ensureContrastAgainstBackground({
    color: tokens.palette.info,
    background: DARK_MODE_BACKGROUND_DEFAULT
  });

  return {
    primary: adjustedPrimary,
    secondary: adjustedSecondary,
    success: adjustedSuccess,
    warning: adjustedWarning,
    error: adjustedError,
    info: adjustedInfo,
    background: {
      default: DARK_MODE_BACKGROUND_DEFAULT,
      paper: DARK_MODE_BACKGROUND_PAPER
    },
    text: {
      primary: DARK_MODE_TEXT_PRIMARY
    },
    divider: toHexWithAlpha(DARK_MODE_TEXT_PRIMARY, 0.12),
    action: buildActionPalette({
      primaryColor: adjustedPrimary,
      textColor: DARK_MODE_TEXT_PRIMARY
    })
  };
};

const toThemePaletteBlock = ({
  mode,
  palette
}: {
  mode: "light" | "dark";
  palette: ResolvedThemePalette;
}): string => {
  return `{
      mode: "${mode}",
      primary: { main: "${palette.primary}" },
      secondary: { main: "${palette.secondary}" },
      success: { main: "${palette.success}" },
      warning: { main: "${palette.warning}" },
      error: { main: "${palette.error}" },
      info: { main: "${palette.info}" },
      background: { default: "${palette.background.default}", paper: "${palette.background.paper}" },
      text: { primary: "${palette.text.primary}" },
      divider: "${palette.divider}",
      action: {
        active: "${palette.action.active}",
        hover: "${palette.action.hover}",
        selected: "${palette.action.selected}",
        disabled: "${palette.action.disabled}",
        disabledBackground: "${palette.action.disabledBackground}",
        focus: "${palette.action.focus}"
      }
    }`;
};

const inferButtonVariant = ({
  element,
  mappedVariant
}: {
  element: ScreenElementIR;
  mappedVariant: ButtonVariant | undefined;
}): ButtonVariant => {
  if (mappedVariant) {
    return mappedVariant;
  }
  const gradientFill = hasVisibleGradient(element.fillGradient);
  const fillColor = toRgbaColor(element.fillColor);
  const hasVisibleFill = gradientFill || isVisibleColor(fillColor);
  const hasContainedFill = gradientFill || (isVisibleColor(fillColor) && !isNearWhiteColor(fillColor));
  const strokeWidth = typeof element.strokeWidth === "number" && Number.isFinite(element.strokeWidth) ? element.strokeWidth : 1;
  const strokeColor = toRgbaColor(element.strokeColor);
  const hasVisibleBorder = strokeWidth > 0 && isVisibleColor(strokeColor);

  if (hasContainedFill) {
    return "contained";
  }
  if (hasVisibleBorder && !hasVisibleFill) {
    return "outlined";
  }
  if (!hasVisibleBorder && !hasVisibleFill) {
    return "text";
  }
  if (hasVisibleBorder) {
    return "outlined";
  }
  return "contained";
};

const inferButtonSize = ({
  element,
  mappedSize
}: {
  element: ScreenElementIR;
  mappedSize: ButtonSize | undefined;
}): ButtonSize | undefined => {
  if (mappedSize) {
    return mappedSize;
  }
  const height = typeof element.height === "number" && Number.isFinite(element.height) ? element.height : undefined;
  if (height === undefined) {
    return undefined;
  }
  if (height <= 32) {
    return "small";
  }
  if (height <= 40) {
    return "medium";
  }
  return "large";
};

const inferButtonFullWidth = ({
  element,
  parent
}: {
  element: ScreenElementIR;
  parent: VirtualParent;
}): boolean => {
  const elementWidth = typeof element.width === "number" && Number.isFinite(element.width) && element.width > 0 ? element.width : undefined;
  const parentWidth = typeof parent.width === "number" && Number.isFinite(parent.width) && parent.width > 0 ? parent.width : undefined;
  if (elementWidth === undefined || parentWidth === undefined) {
    return false;
  }
  return Math.abs(parentWidth - elementWidth) / parentWidth <= BUTTON_FULL_WIDTH_EPSILON;
};

const inferButtonDisabled = ({
  element,
  mappedDisabled,
  buttonTextColor
}: {
  element: ScreenElementIR;
  mappedDisabled: boolean | undefined;
  buttonTextColor: string | undefined;
}): boolean => {
  if (mappedDisabled) {
    return true;
  }
  if (typeof element.opacity === "number" && Number.isFinite(element.opacity) && element.opacity <= BUTTON_DISABLED_OPACITY_THRESHOLD) {
    return true;
  }

  const fillColor = toRgbaColor(element.fillColor);
  const textColor = toRgbaColor(buttonTextColor);
  const hasNeutralFillAndText = isNeutralGrayColor(fillColor) && isNeutralGrayColor(textColor);
  return hasNeutralFillAndText;
};

const filterButtonVariantEntries = ({
  entries,
  variant,
  element,
  fullWidth,
  tokens
}: {
  entries: Array<[string, string | number | undefined]>;
  variant: ButtonVariant;
  element: ScreenElementIR;
  fullWidth: boolean;
  tokens: DesignTokens | undefined;
}): Array<[string, string | number | undefined]> => {
  const keysToDrop = new Set<string>();
  if (fullWidth) {
    keysToDrop.add("width");
    keysToDrop.add("maxWidth");
  }

  if (variant === "contained") {
    keysToDrop.add("border");
    keysToDrop.add("borderColor");
    if (hasVisibleGradient(element.fillGradient)) {
      keysToDrop.add("bgcolor");
    } else {
      keysToDrop.add("background");
      const normalizedFill = normalizeHexColor(element.fillColor);
      const mappedFill = toThemePaletteLiteral({ color: element.fillColor, tokens });
      if (!normalizedFill || mappedFill === "primary.main") {
        keysToDrop.add("bgcolor");
      }
    }
  } else {
    keysToDrop.add("background");
    keysToDrop.add("bgcolor");
    keysToDrop.add("border");
    keysToDrop.add("borderColor");
  }

  return entries.filter(([key]) => !keysToDrop.has(key));
};

const mapPrimaryAxisAlignToJustifyContent = (
  value: ScreenElementIR["primaryAxisAlignItems"]
): string | undefined => {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
};

const mapCounterAxisAlignToAlignItems = (
  value: ScreenElementIR["counterAxisAlignItems"],
  layoutMode: ScreenElementIR["layoutMode"]
): string | undefined => {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "BASELINE":
      return "baseline";
    default:
      return layoutMode === "HORIZONTAL" ? "center" : undefined;
  }
};

const hasVisualStyle = (element: ScreenElementIR): boolean => {
  return Boolean(
    element.fillColor ||
      element.fillGradient ||
      normalizeOpacityForSx(element.opacity) !== undefined ||
      element.insetShadow ||
      (typeof element.elevation === "number" && element.elevation > 0) ||
      element.strokeColor ||
      (element.cornerRadius ?? 0) > 0 ||
      (element.padding &&
        (element.padding.top > 0 ||
          element.padding.right > 0 ||
          element.padding.bottom > 0 ||
          element.padding.left > 0)) ||
      (element.margin &&
        (element.margin.top > 0 || element.margin.right > 0 || element.margin.bottom > 0 || element.margin.left > 0))
  );
};

const isIconLikeNode = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return (
    loweredName.includes("muisvgiconroot") ||
    loweredName.includes("iconcomponent") ||
    loweredName.startsWith("ic_") ||
    loweredName.startsWith("icon/") ||
    loweredName.startsWith("icons/") ||
    loweredName.startsWith("icon-") ||
    loweredName.startsWith("icon_")
  );
};

const isSemanticIconWrapper = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return loweredName.includes("buttonendicon") || loweredName.includes("expandiconwrapper");
};

const shouldPromoteChildren = (element: ScreenElementIR): boolean => {
  if (element.prototypeNavigation) {
    return false;
  }
  if (isIconLikeNode(element) || isSemanticIconWrapper(element)) {
    return false;
  }

  if (element.type !== "container") {
    return false;
  }
  if (hasVisualStyle(element) || element.text?.trim()) {
    return false;
  }

  const children = element.children ?? [];
  if (children.length === 0) {
    return false;
  }

  if (
    children.some((child) => {
      return isIconLikeNode(child) || isSemanticIconWrapper(child);
    })
  ) {
    return false;
  }

  if (children.length === 1) {
    return true;
  }

  return false;
};

const simplifyNode = (element: ScreenElementIR): ScreenElementIR | null => {
  const simplifiedChildren = simplifyElements(element.children ?? []);
  const isSvgIconRoot = isIconLikeNode(element);
  const hasVectorPayload = element.nodeType === "VECTOR" && (element.vectorPaths?.length ?? 0) > 0;

  const simplified: ScreenElementIR = {
    ...element,
    children: simplifiedChildren
  };

  if (simplified.type === "text") {
    return simplified.text?.trim() ? simplified : null;
  }

  if (simplified.type === "image") {
    return simplified;
  }

  if (hasVectorPayload) {
    return simplified;
  }

  if (isSvgIconRoot || isSemanticIconWrapper(element)) {
    return simplified;
  }

  const hasChildren = simplifiedChildren.length > 0;
  if (!hasChildren && !hasVisualStyle(simplified) && !simplified.text?.trim()) {
    if (simplified.prototypeNavigation) {
      return simplified;
    }
    return null;
  }

  return simplified;
};

const simplifyElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const result: ScreenElementIR[] = [];

  for (const element of elements) {
    const simplified = simplifyNode(element);
    if (!simplified) {
      continue;
    }

    if (shouldPromoteChildren(simplified)) {
      result.push(...(simplified.children ?? []));
      continue;
    }

    result.push(simplified);
  }

  return result;
};

const RTL_LANGUAGE_CODES = new Set(["ar", "he", "fa", "ur"]);
const VISUAL_SORT_ROW_TOLERANCE_PX = 18;

interface SortChildrenOptions {
  generationLocale?: string;
}

interface SortableChild {
  child: ScreenElementIR;
  sourceIndex: number;
  rowIndex: number;
  semanticBucket: number;
}

const toLocaleLanguageCode = (locale: string | undefined): string | undefined => {
  if (typeof locale !== "string") {
    return undefined;
  }
  const trimmed = locale.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const canonical = Intl.getCanonicalLocales(trimmed)[0];
    if (!canonical) {
      return undefined;
    }
    const [language] = canonical.toLowerCase().split("-");
    return language;
  } catch {
    const [fallback] = trimmed.toLowerCase().split(/[_-]+/);
    return fallback || undefined;
  }
};

const isRtlLocale = (locale: string | undefined): boolean => {
  const languageCode = toLocaleLanguageCode(locale);
  if (!languageCode) {
    return false;
  }
  return RTL_LANGUAGE_CODES.has(languageCode);
};

const toSortSemanticBucket = (element: ScreenElementIR): number => {
  const normalizedName = normalizeInputSemanticText(element.name || "");
  const normalizedText = normalizeInputSemanticText(element.text?.trim() || "");
  const combinedSemanticText = `${normalizedName} ${normalizedText}`.trim();
  const hasHeadingHint = HEADING_NAME_HINTS.some((hint) => combinedSemanticText.includes(hint));
  const fontSize = typeof element.fontSize === "number" && Number.isFinite(element.fontSize) ? element.fontSize : 0;
  const fontWeight = typeof element.fontWeight === "number" && Number.isFinite(element.fontWeight) ? element.fontWeight : 0;
  const isLargeHeadingText = element.type === "text" && (fontSize >= 24 || (fontSize >= 20 && fontWeight >= 600));
  if (hasHeadingHint || isLargeHeadingText) {
    return 0;
  }

  const hasNavigationHint = A11Y_NAVIGATION_HINTS.some((hint) => normalizedName.includes(hint));
  if (element.type === "navigation" || hasNavigationHint) {
    return 1;
  }

  const hasReadableText = Boolean(firstText(element)?.trim() || element.text?.trim());
  const isDecorativeImage =
    element.type === "image" &&
    A11Y_IMAGE_DECORATIVE_HINTS.some((hint) => normalizedName.includes(hint));
  const isIconOnlyDecorative = (isIconLikeNode(element) || isSemanticIconWrapper(element)) && !hasReadableText;
  const isDecorative = element.type === "divider" || element.type === "skeleton" || isDecorativeImage || isIconOnlyDecorative;
  if (isDecorative) {
    return 3;
  }

  return 2;
};

const hasOverlap = (left: ScreenElementIR, right: ScreenElementIR): boolean => {
  const leftX = left.x;
  const leftY = left.y;
  const leftWidth = left.width;
  const leftHeight = left.height;
  const rightX = right.x;
  const rightY = right.y;
  const rightWidth = right.width;
  const rightHeight = right.height;
  if (
    typeof leftX !== "number" ||
    typeof leftY !== "number" ||
    typeof leftWidth !== "number" ||
    typeof leftHeight !== "number" ||
    typeof rightX !== "number" ||
    typeof rightY !== "number" ||
    typeof rightWidth !== "number" ||
    typeof rightHeight !== "number" ||
    !Number.isFinite(leftX) ||
    !Number.isFinite(leftY) ||
    !Number.isFinite(leftWidth) ||
    !Number.isFinite(leftHeight) ||
    !Number.isFinite(rightX) ||
    !Number.isFinite(rightY) ||
    !Number.isFinite(rightWidth) ||
    !Number.isFinite(rightHeight) ||
    leftWidth <= 0 ||
    leftHeight <= 0 ||
    rightWidth <= 0 ||
    rightHeight <= 0
  ) {
    return false;
  }
  const leftMaxX = leftX + leftWidth;
  const leftMaxY = leftY + leftHeight;
  const rightMaxX = rightX + rightWidth;
  const rightMaxY = rightY + rightHeight;
  return leftX < rightMaxX && leftMaxX > rightX && leftY < rightMaxY && leftMaxY > rightY;
};

const sortChildren = (
  children: ScreenElementIR[],
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE",
  options?: SortChildrenOptions
): ScreenElementIR[] => {
  const copied = [...children];
  if (copied.length <= 1) {
    return copied;
  }

  if (layoutMode === "HORIZONTAL") {
    copied.sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
    return copied;
  }

  if (layoutMode === "VERTICAL") {
    copied.sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0));
    return copied;
  }

  const rowClusters = clusterAxisValues({
    values: copied.map((child) => child.y ?? 0),
    tolerance: VISUAL_SORT_ROW_TOLERANCE_PX
  });
  const rtl = isRtlLocale(options?.generationLocale);
  const sortableChildren: SortableChild[] = copied.map((child, sourceIndex) => {
    const rowIndex = toNearestClusterIndex({
      value: child.y ?? 0,
      clusters: rowClusters
    });
    return {
      child,
      sourceIndex,
      rowIndex,
      semanticBucket: toSortSemanticBucket(child)
    };
  });

  sortableChildren.sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    if (hasOverlap(left.child, right.child)) {
      return left.sourceIndex - right.sourceIndex;
    }

    if (left.semanticBucket !== right.semanticBucket) {
      return left.semanticBucket - right.semanticBucket;
    }

    const yDelta = (left.child.y ?? 0) - (right.child.y ?? 0);
    if (yDelta !== 0) {
      return yDelta;
    }

    const xDelta = rtl ? (right.child.x ?? 0) - (left.child.x ?? 0) : (left.child.x ?? 0) - (right.child.x ?? 0);
    if (xDelta !== 0) {
      return xDelta;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  return sortableChildren.map((entry) => entry.child);
};

const sxString = (entries: Array<[string, string | number | undefined]>): string => {
  const deduped: Array<[string, string | number]> = [];
  const seen = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (value === undefined || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.unshift([key, value]);
  }
  return deduped.map(([key, value]) => `${key}: ${typeof value === "number" ? value : value}`).join(", ");
};

const toPaintSxEntries = ({
  fillColor,
  fillGradient,
  includePaints,
  tokens
}: {
  fillColor: ScreenElementIR["fillColor"];
  fillGradient: ScreenElementIR["fillGradient"];
  includePaints: boolean;
  tokens: DesignTokens | undefined;
}): Array<[string, string | number | undefined]> => {
  if (!includePaints) {
    return [];
  }
  return [
    ["background", fillGradient ? literal(fillGradient) : undefined],
    ["bgcolor", !fillGradient ? toThemeColorLiteral({ color: fillColor, tokens }) : undefined]
  ];
};

const normalizeElevationForSx = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return clamp(Math.round(value), 0, 24);
};

const toShadowSxEntry = ({
  elevation,
  insetShadow,
  preferInsetShadow
}: {
  elevation: number | undefined;
  insetShadow: string | undefined;
  preferInsetShadow: boolean;
}): string | number | undefined => {
  const normalizedInset = typeof insetShadow === "string" && insetShadow.trim().length > 0 ? literal(insetShadow.trim()) : undefined;
  const normalizedElevation = normalizeElevationForSx(elevation);

  if (preferInsetShadow) {
    return normalizedInset ?? normalizedElevation;
  }
  return normalizedElevation !== undefined ? normalizedElevation : normalizedInset;
};

const toVariantStateSxObject = ({
  style,
  tokens
}: {
  style: VariantStateStyle | undefined;
  tokens: DesignTokens | undefined;
}): string | undefined => {
  if (!style) {
    return undefined;
  }
  const stateSx = sxString([
    ["bgcolor", toThemeColorLiteral({ color: style.backgroundColor, tokens })],
    ["borderColor", toThemeColorLiteral({ color: style.borderColor, tokens })],
    ["color", toThemeColorLiteral({ color: style.color, tokens })]
  ]);
  if (!stateSx.trim()) {
    return undefined;
  }
  return `{ ${stateSx} }`;
};

const appendVariantStateOverridesToSx = ({
  sx,
  element,
  tokens
}: {
  sx: string;
  element: ScreenElementIR;
  tokens: DesignTokens | undefined;
}): string => {
  const stateOverrides = element.variantMapping?.stateOverrides;
  if (!stateOverrides) {
    return sx;
  }
  const selectors = [
    ["\"&:hover\"", toVariantStateSxObject({ style: stateOverrides.hover, tokens })],
    ["\"&:active\"", toVariantStateSxObject({ style: stateOverrides.active, tokens })],
    ["\"&.Mui-disabled\"", toVariantStateSxObject({ style: stateOverrides.disabled, tokens })]
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([selector, style]) => `${selector}: ${style}`);
  if (selectors.length === 0) {
    return sx;
  }
  const normalizedBase = sx.trim();
  if (!normalizedBase) {
    return selectors.join(", ");
  }
  return `${normalizedBase}, ${selectors.join(", ")}`;
};

const toChipVariant = (value: "contained" | "outlined" | "text" | undefined): "filled" | "outlined" | undefined => {
  if (!value) {
    return undefined;
  }
  if (value === "outlined") {
    return "outlined";
  }
  return "filled";
};

const toChipSize = (value: "small" | "medium" | "large" | undefined): "small" | "medium" | undefined => {
  if (value === "small") {
    return "small";
  }
  if (value === "medium" || value === "large") {
    return "medium";
  }
  return undefined;
};

const indentBlock = (value: string, spaces: number): string => {
  const indent = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join("\n");
};

const baseLayoutEntries = (
  element: ScreenElementIR,
  parent: VirtualParent,
  options?: {
    includePaints?: boolean;
    preferInsetShadow?: boolean;
    spacingBase?: number;
    tokens?: DesignTokens | undefined;
  }
): Array<[string, string | number | undefined]> => {
  const includePaints = options?.includePaints ?? true;
  const preferInsetShadow = options?.preferInsetShadow ?? true;
  const spacingBase = normalizeSpacingBase(options?.spacingBase);
  const tokens = options?.tokens;
  const parentLayout = parent.layoutMode ?? "NONE";
  const parentWidth =
    typeof parent.width === "number" && Number.isFinite(parent.width) && parent.width > 0 ? parent.width : undefined;
  const elementWidth =
    typeof element.width === "number" && Number.isFinite(element.width) && element.width > 0 ? element.width : undefined;
  const isAbsoluteChild =
    parentLayout === "NONE" &&
    typeof element.x === "number" &&
    typeof element.y === "number" &&
    typeof parent.x === "number" &&
    typeof parent.y === "number";

  const layoutMode = element.layoutMode ?? "NONE";
  const hasChildren = (element.children?.length ?? 0) > 0;
  const isFlex = layoutMode === "VERTICAL" || layoutMode === "HORIZONTAL";
  const isFlowContainer = hasChildren && !isAbsoluteChild && (layoutMode !== "NONE" || parentLayout !== "NONE");
  const resolvedPosition = isAbsoluteChild ? "absolute" : layoutMode === "NONE" && hasChildren ? "relative" : undefined;
  const responsiveWidth = isFlowContainer
    ? parentWidth && elementWidth
      ? toPercentLiteralFromRatio(elementWidth / parentWidth) ?? literal("100%")
      : literal("100%")
    : undefined;

  const entries: Array<[string, string | number | undefined]> = [
    ["position", resolvedPosition ? literal(resolvedPosition) : undefined],
    ["left", isAbsoluteChild ? toPxLiteral((element.x ?? 0) - (parent.x ?? 0)) : undefined],
    ["top", isAbsoluteChild ? toPxLiteral((element.y ?? 0) - (parent.y ?? 0)) : undefined],
    ["width", isFlowContainer ? responsiveWidth : toPxLiteral(element.width)],
    ["maxWidth", isFlowContainer ? toPxLiteral(element.width) : undefined],
    ["height", !hasChildren ? toPxLiteral(element.height) : undefined],
    ["minHeight", hasChildren ? toPxLiteral(element.height) : undefined],
    ["display", isFlex ? literal("flex") : undefined],
    ["flexDirection", layoutMode === "VERTICAL" ? literal("column") : layoutMode === "HORIZONTAL" ? literal("row") : undefined],
    [
      "alignItems",
      isFlex
        ? (() => {
            const alignItems = mapCounterAxisAlignToAlignItems(element.counterAxisAlignItems, layoutMode);
            return alignItems ? literal(alignItems) : undefined;
          })()
        : undefined
    ],
    [
      "justifyContent",
      isFlex
        ? (() => {
            const justifyContent = mapPrimaryAxisAlignToJustifyContent(element.primaryAxisAlignItems);
            return justifyContent ? literal(justifyContent) : undefined;
          })()
        : undefined
    ],
    [
      "gap",
      element.gap && element.gap > 0 ? toSpacingUnitValue({ value: element.gap, spacingBase }) : undefined
    ],
    ...toBoxSpacingSxEntries({
      values: element.padding,
      spacingBase,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    }),
    ...toBoxSpacingSxEntries({
      values: element.margin,
      spacingBase,
      allKey: "m",
      xKey: "mx",
      yKey: "my",
      topKey: "mt",
      rightKey: "mr",
      bottomKey: "mb",
      leftKey: "ml"
    }),
    ["opacity", normalizeOpacityForSx(element.opacity)],
    ...toPaintSxEntries({
      fillColor: element.fillColor,
      fillGradient: element.fillGradient,
      includePaints,
      tokens
    }),
    [
      "border",
      includePaints && element.strokeColor
        ? literal(`${Math.max(1, Math.round(element.strokeWidth ?? 1))}px solid`)
        : undefined
    ],
    ["borderColor", includePaints ? toThemeColorLiteral({ color: element.strokeColor, tokens }) : undefined],
    ["borderRadius", toThemeBorderRadiusValue({ radiusPx: element.cornerRadius, tokens })],
    [
      "boxShadow",
      toShadowSxEntry({
        elevation: element.elevation,
        insetShadow: element.insetShadow,
        preferInsetShadow
      })
    ]
  ];

  return entries;
};

const RESPONSIVE_MEDIA_QUERY_BY_BREAKPOINT: Record<ResponsiveBreakpoint, string> = {
  xs: "@media (max-width: 428px)",
  sm: "@media (min-width: 429px) and (max-width: 768px)",
  md: "@media (min-width: 769px) and (max-width: 1024px)",
  lg: "@media (min-width: 1025px) and (max-width: 1440px)",
  xl: "@media (min-width: 1441px)"
};

const RESPONSIVE_BREAKPOINT_ORDER: ResponsiveBreakpoint[] = ["xs", "sm", "md", "lg", "xl"];

const pushResponsiveStyleEntry = ({
  byBreakpoint,
  breakpoint,
  entry
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, Array<[string, string | number | undefined]>>;
  breakpoint: ResponsiveBreakpoint;
  entry: [string, string | number | undefined];
}): void => {
  const current = byBreakpoint.get(breakpoint) ?? [];
  current.push(entry);
  byBreakpoint.set(breakpoint, current);
};

const appendLayoutOverrideEntriesForBreakpoint = ({
  byBreakpoint,
  breakpoint,
  baseLayoutMode,
  override,
  spacingBase
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, Array<[string, string | number | undefined]>>;
  breakpoint: ResponsiveBreakpoint;
  baseLayoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  override: ScreenResponsiveLayoutOverride;
  spacingBase: number;
}): void => {
  const effectiveLayoutMode = override.layoutMode ?? baseLayoutMode;
  if (override.layoutMode) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["display", literal(effectiveLayoutMode === "NONE" ? "block" : "flex")]
    });
    if (effectiveLayoutMode !== "NONE") {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["flexDirection", literal(effectiveLayoutMode === "HORIZONTAL" ? "row" : "column")]
      });
    }
  }

  if (override.primaryAxisAlignItems) {
    const justifyContent = mapPrimaryAxisAlignToJustifyContent(override.primaryAxisAlignItems);
    if (justifyContent) {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["justifyContent", literal(justifyContent)]
      });
    }
  } else if (override.layoutMode === "NONE") {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["justifyContent", literal("initial")]
    });
  }

  if (override.counterAxisAlignItems) {
    const alignItems = mapCounterAxisAlignToAlignItems(override.counterAxisAlignItems, effectiveLayoutMode);
    if (alignItems) {
      pushResponsiveStyleEntry({
        byBreakpoint,
        breakpoint,
        entry: ["alignItems", literal(alignItems)]
      });
    }
  } else if (override.layoutMode === "NONE") {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["alignItems", literal("initial")]
    });
  }

  if (typeof override.gap === "number" && Number.isFinite(override.gap)) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["gap", toSpacingUnitValue({ value: override.gap, spacingBase })]
    });
  }

  if (typeof override.widthRatio === "number" && Number.isFinite(override.widthRatio) && override.widthRatio > 0) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["width", toPercentLiteralFromRatio(override.widthRatio)]
    });
  }

  if (typeof override.minHeight === "number" && Number.isFinite(override.minHeight) && override.minHeight > 0) {
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint,
      entry: ["minHeight", toPxLiteral(override.minHeight)]
    });
  }
};

const toResponsiveMediaEntries = (
  byBreakpoint: Map<ResponsiveBreakpoint, Array<[string, string | number | undefined]>>
): Array<[string, string | number | undefined]> => {
  const entries: Array<[string, string | number | undefined]> = [];
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const styleEntries = byBreakpoint.get(breakpoint);
    if (!styleEntries || styleEntries.length === 0) {
      continue;
    }
    const styleBody = sxString(styleEntries);
    if (!styleBody) {
      continue;
    }
    entries.push([literal(RESPONSIVE_MEDIA_QUERY_BY_BREAKPOINT[breakpoint]), `{ ${styleBody} }`]);
  }
  return entries;
};

const toResponsiveLayoutMediaEntries = ({
  baseLayoutMode,
  overrides,
  spacingBase
}: {
  baseLayoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  overrides: ScreenResponsiveLayoutOverridesByBreakpoint | undefined;
  spacingBase: number;
}): Array<[string, string | number | undefined]> => {
  if (!overrides) {
    return [];
  }
  const byBreakpoint = new Map<ResponsiveBreakpoint, Array<[string, string | number | undefined]>>();
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const override = overrides[breakpoint];
    if (!override) {
      continue;
    }
    appendLayoutOverrideEntriesForBreakpoint({
      byBreakpoint,
      breakpoint,
      baseLayoutMode,
      override,
      spacingBase
    });
  }
  return toResponsiveMediaEntries(byBreakpoint);
};

const toElementSx = ({
  element,
  parent,
  context,
  includePaints = true,
  preferInsetShadow = true
}: {
  element: ScreenElementIR;
  parent: VirtualParent;
  context: RenderContext;
  includePaints?: boolean;
  preferInsetShadow?: boolean;
}): string => {
  const responsiveEntries = toResponsiveLayoutMediaEntries({
    baseLayoutMode: element.layoutMode ?? "NONE",
    overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
    spacingBase: context.spacingBase
  });
  return sxString([
    ...baseLayoutEntries(element, parent, {
      includePaints,
      preferInsetShadow,
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...responsiveEntries
  ]);
};

const toScreenResponsiveRootMediaEntries = ({
  screen,
  spacingBase
}: {
  screen: ScreenIR;
  spacingBase: number;
}): Array<[string, string | number | undefined]> => {
  if (!screen.responsive) {
    return [];
  }

  const byBreakpoint = new Map<ResponsiveBreakpoint, Array<[string, string | number | undefined]>>();

  for (const variant of screen.responsive.variants) {
    if (typeof variant.width !== "number" || !Number.isFinite(variant.width) || variant.width <= 0) {
      continue;
    }
    pushResponsiveStyleEntry({
      byBreakpoint,
      breakpoint: variant.breakpoint,
      entry: ["maxWidth", literal(`${Math.round(variant.width)}px`)]
    });
  }

  const rootOverrides = screen.responsive.rootLayoutOverrides;
  if (rootOverrides) {
    for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
      const override = rootOverrides[breakpoint];
      if (!override) {
        continue;
      }
      appendLayoutOverrideEntriesForBreakpoint({
        byBreakpoint,
        breakpoint,
        baseLayoutMode: screen.layoutMode,
        override,
        spacingBase
      });
    }
  }

  return toResponsiveMediaEntries(byBreakpoint);
};

const renderText = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Typography");
  const indent = "  ".repeat(depth);
  const text = literal(element.text?.trim() || element.name);
  const headingComponent = context.headingComponentByNodeId.get(element.id);
  const typographyVariantName = context.typographyVariantByNodeId.get(element.id);
  const typographyVariant = typographyVariantName && context.tokens ? context.tokens.typography[typographyVariantName] : undefined;
  const normalizedFont = normalizeFontFamily(element.fontFamily);
  const normalizedVariantFont = normalizeFontFamily(typographyVariant?.fontFamily ?? context.tokens?.fontFamily);
  const letterSpacingEm = toLetterSpacingEm({
    letterSpacingPx: element.letterSpacing,
    fontSizePx: element.fontSize
  });
  const textLayoutEntries = [
    ...baseLayoutEntries(element, parent, {
      includePaints: false,
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase
    })
  ].filter(([key]) => {
    return key !== "width" && key !== "height" && key !== "minHeight";
  });

  const isLinkLikeColor = element.fillColor && /^#0[0-4][0-9a-f]{4}$/i.test(element.fillColor);
  const omitFontSize = typographyVariant
    ? approximatelyEqualNumber({
        left: element.fontSize,
        right: typographyVariant.fontSizePx,
        tolerance: 2
      })
    : false;
  const omitFontWeight = typographyVariant
    ? approximatelyEqualNumber({
        left: element.fontWeight,
        right: typographyVariant.fontWeight,
        tolerance: 75
      })
    : false;
  const omitLineHeight = typographyVariant
    ? approximatelyEqualNumber({
        left: element.lineHeight,
        right: typographyVariant.lineHeightPx,
        tolerance: 3
      })
    : false;
  const omitFontFamily = typographyVariant
    ? (!normalizedFont && !normalizedVariantFont) || normalizedFont === normalizedVariantFont
    : false;
  const omitLetterSpacing = typographyVariant
    ? approximatelyEqualNumber({
        left: letterSpacingEm,
        right: typographyVariant.letterSpacingEm,
        tolerance: 0.02
      })
    : false;
  const sx = sxString([
    ...textLayoutEntries,
    ["fontSize", omitFontSize ? undefined : element.fontSize ? toRemLiteral(element.fontSize) : undefined],
    ["fontWeight", omitFontWeight ? undefined : element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", omitLineHeight ? undefined : element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
    ["fontFamily", omitFontFamily ? undefined : normalizedFont ? literal(normalizedFont) : undefined],
    ["letterSpacing", omitLetterSpacing ? undefined : toEmLiteral(letterSpacingEm)],
    ["color", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })],
    [
      "textAlign",
      element.textAlign === "LEFT"
        ? literal("left")
        : element.textAlign === "CENTER"
          ? literal("center")
          : element.textAlign === "RIGHT"
            ? literal("right")
            : undefined
    ],
    ["textDecoration", isLinkLikeColor ? literal("underline") : undefined],
    ["cursor", isLinkLikeColor ? literal("pointer") : undefined],
    ["whiteSpace", literal("pre-wrap")]
  ]);

  const foregroundHex = normalizeHexColor(element.fillColor);
  const backgroundHex = resolveBackgroundHexForText({ parent, context });
  if (foregroundHex && backgroundHex) {
    const foregroundRgba = toRgbaColor(foregroundHex);
    const backgroundRgba = toRgbaColor(backgroundHex);
    if (foregroundRgba && backgroundRgba) {
      const contrastRatio = toContrastRatio(foregroundRgba, backgroundRgba);
      if (contrastRatio < WCAG_AA_NORMAL_TEXT_CONTRAST_MIN) {
        pushLowContrastWarning({
          context,
          element,
          foreground: foregroundHex,
          background: backgroundHex,
          contrastRatio
        });
      }
    }
  }

  const variantProp = typographyVariantName ? ` variant="${typographyVariantName}"` : "";
  const headingProp = headingComponent ? ` component="${headingComponent}"` : "";
  return `${indent}<Typography${variantProp}${headingProp} sx={{ ${sx} }}>{${text}}</Typography>`;
};

const firstText = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
  if (visited.has(element)) {
    return undefined;
  }
  visited.add(element);
  if (element.type === "text" && element.text?.trim()) {
    return element.text.trim();
  }
  for (const child of element.children ?? []) {
    const match = firstText(child, visited);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const firstTextColor = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
  if (visited.has(element)) {
    return undefined;
  }
  visited.add(element);
  if (element.type === "text" && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstTextColor(child, visited);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectVectorPaths = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const localPaths = Array.isArray(element.vectorPaths)
    ? element.vectorPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];
  const nestedPaths = (element.children ?? []).flatMap((child) => collectVectorPaths(child, visited));
  return [...new Set([...localPaths, ...nestedPaths])];
};

const firstVectorColor = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
  if (visited.has(element)) {
    return undefined;
  }
  visited.add(element);
  if (Array.isArray(element.vectorPaths) && element.vectorPaths.length > 0 && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstVectorColor(child, visited);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectTextNodes = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const local = element.type === "text" && element.text?.trim() ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectTextNodes(child, visited));
  return [...local, ...nested];
};

const approximatelyEqualNumber = ({
  left,
  right,
  tolerance
}: {
  left: number | undefined;
  right: number | undefined;
  tolerance: number;
}): boolean => {
  if (typeof left !== "number" || !Number.isFinite(left) || typeof right !== "number" || !Number.isFinite(right)) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
};

const isHeadingTypographyVariant = (variantName: DesignTokenTypographyVariantName): boolean => {
  return /^h[1-6]$/.test(variantName);
};

const isHeadingLikeTextNode = (node: ScreenElementIR): boolean => {
  const normalizedName = normalizeInputSemanticText(node.name);
  return (
    HEADING_NAME_HINTS.some((hint) => normalizedName.includes(hint)) ||
    (typeof node.fontSize === "number" && node.fontSize >= 20) ||
    (typeof node.fontWeight === "number" && node.fontWeight >= 650)
  );
};

const resolveTypographyVariantByNodeId = ({
  elements,
  tokens
}: {
  elements: ScreenElementIR[];
  tokens: DesignTokens | undefined;
}): Map<string, DesignTokenTypographyVariantName> => {
  const byNodeId = new Map<string, DesignTokenTypographyVariantName>();
  if (!tokens) {
    return byNodeId;
  }

  const variants = DESIGN_TYPOGRAPHY_VARIANTS.map((variantName) => ({
    variantName,
    variant: tokens.typography[variantName]
  }));

  for (const node of elements.flatMap((element) => collectTextNodes(element))) {
    if (
      typeof node.fontSize !== "number" &&
      typeof node.fontWeight !== "number" &&
      typeof node.lineHeight !== "number" &&
      !node.fontFamily
    ) {
      continue;
    }
    const elementLetterSpacingEm = toLetterSpacingEm({
      letterSpacingPx: node.letterSpacing,
      fontSizePx: node.fontSize
    });
    const elementFontFamily = normalizeFontFamily(node.fontFamily);
    const headingLike = isHeadingLikeTextNode(node);

    const ranked = variants
      .map(({ variantName, variant }) => {
        const sizeDiff = Math.abs((node.fontSize ?? variant.fontSizePx) - variant.fontSizePx);
        const weightDiff = Math.abs((node.fontWeight ?? variant.fontWeight) - variant.fontWeight);
        const lineDiff = Math.abs((node.lineHeight ?? variant.lineHeightPx) - variant.lineHeightPx);
        const letterSpacingDiff = Math.abs((elementLetterSpacingEm ?? 0) - (variant.letterSpacingEm ?? 0));
        const tokenFontFamily = normalizeFontFamily(variant.fontFamily ?? tokens.fontFamily);
        const familyMismatch = elementFontFamily && tokenFontFamily && elementFontFamily !== tokenFontFamily ? 1.25 : 0;
        const headingPenalty = headingLike === isHeadingTypographyVariant(variantName) ? 0 : 0.75;
        return {
          variantName,
          score: sizeDiff * 3 + weightDiff / 200 + lineDiff / 4 + letterSpacingDiff * 8 + familyMismatch + headingPenalty,
          sizeDiff,
          weightDiff,
          lineDiff
        };
      })
      .sort((left, right) => left.score - right.score || left.sizeDiff - right.sizeDiff);

    const bestMatch = ranked[0];
    if (!bestMatch) {
      continue;
    }
    if (bestMatch.sizeDiff > 2 || bestMatch.weightDiff > 350 || bestMatch.lineDiff > 6 || bestMatch.score > 9) {
      continue;
    }
    byNodeId.set(node.id, bestMatch.variantName);
  }

  return byNodeId;
};

const hasMeaningfulTextDescendants = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  const cached = context.meaningfulTextDescendantCache.get(element.id);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = collectTextNodes(element).some((node) => {
    const text = node.text?.trim() ?? "";
    if (!text) {
      return false;
    }
    return /[a-z0-9]/i.test(text);
  });
  context.meaningfulTextDescendantCache.set(element.id, resolved);
  return resolved;
};

const collectIconNodes = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const local = isIconLikeNode(element) ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectIconNodes(child, visited));
  return [...local, ...nested];
};

const collectSubtreeNames = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element.name, ...(element.children ?? []).flatMap((child) => collectSubtreeNames(child, visited))];
};

const A11Y_GENERIC_LABEL_PATTERNS = [
  /^frame\s*\d*$/i,
  /^group\s*\d*$/i,
  /^rectangle\s*\d*$/i,
  /^vector\s*\d*$/i,
  /^instance\s*\d*$/i,
  /^node\s*\d*$/i,
  /^component\s*\d*$/i,
  /^styled\(div\)$/i,
  /^mui[a-z0-9_-]+$/i
];
const A11Y_IMAGE_DECORATIVE_HINTS = ["decorative", "background", "placeholder", "pattern", "shape"];
const A11Y_NAVIGATION_HINTS = ["navigation", "navbar", "nav bar", "menu", "sidebar", "tabbar", "drawer"];
const A11Y_INTERACTIVE_TYPES = new Set<ScreenElementIR["type"]>([
  "button",
  "input",
  "select",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "rating",
  "tab",
  "navigation",
  "breadcrumbs",
  "drawer"
]);
const HEADING_NAME_HINTS = ["heading", "headline", "title", "h1", "h2", "h3", "ueberschrift", "überschrift", "titel"];

const toA11yHumanizedLabel = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value
    .replace(/[_./:-]+/g, " ")
    .replace(/\b(ic|icon|root|wrapper|container|component)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  if (A11Y_GENERIC_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const resolveElementA11yLabel = ({
  element,
  fallback
}: {
  element: ScreenElementIR;
  fallback: string;
}): string => {
  const textLabel = toA11yHumanizedLabel(firstText(element)?.trim());
  if (textLabel) {
    return textLabel;
  }
  const nameLabel = toA11yHumanizedLabel(element.name);
  if (nameLabel) {
    return nameLabel;
  }
  return fallback;
};

const escapeXmlText = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const toDeterministicImagePlaceholderSrc = ({
  element,
  label
}: {
  element: ScreenElementIR;
  label: string;
}): string => {
  const width = Math.max(1, Math.round(element.width ?? 320));
  const height = Math.max(1, Math.round(element.height ?? 180));
  const safeLabel = escapeXmlText(label.trim() || "Image");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#f3f4f6"/><stop offset="100%" stop-color="#e5e7eb"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="14" fill="#6b7280">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const resolveImageSource = ({
  element,
  context,
  fallbackLabel
}: {
  element: ScreenElementIR;
  context: RenderContext;
  fallbackLabel: string;
}): string => {
  const mappedSource = context.imageAssetMap[element.id];
  if (typeof mappedSource === "string" && mappedSource.trim().length > 0) {
    return mappedSource.trim();
  }
  return toDeterministicImagePlaceholderSrc({
    element,
    label: fallbackLabel
  });
};

const resolveIconButtonAriaLabel = ({
  element,
  iconNode
}: {
  element: ScreenElementIR;
  iconNode: ScreenElementIR | undefined;
}): string => {
  const elementLabel = toA11yHumanizedLabel(element.name);
  if (elementLabel) {
    return elementLabel;
  }
  const iconLabel = toA11yHumanizedLabel(iconNode?.name);
  if (iconLabel) {
    return iconLabel;
  }
  return "Button";
};

const hasInteractiveDescendants = ({
  element,
  context,
  visited = new Set<ScreenElementIR>()
}: {
  element: ScreenElementIR;
  context: RenderContext;
  visited?: Set<ScreenElementIR>;
}): boolean => {
  if (visited.has(element)) {
    return false;
  }
  const cached = context.interactiveDescendantCache.get(element.id);
  if (cached !== undefined) {
    return cached;
  }
  visited.add(element);
  const resolved =
    A11Y_INTERACTIVE_TYPES.has(element.type) ||
    (element.children ?? []).some((child) => hasInteractiveDescendants({ element: child, context, visited }));
  visited.delete(element);
  context.interactiveDescendantCache.set(element.id, resolved);
  return resolved;
};

const inferLandmarkRole = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): LandmarkRole | undefined => {
  if (element.type === "navigation") {
    return "navigation";
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  if (!normalizedName) {
    return undefined;
  }
  const hasHint = A11Y_NAVIGATION_HINTS.some((hint) => normalizedName.includes(hint));
  if (!hasHint) {
    return undefined;
  }
  if (element.type === "input" || element.type === "select") {
    return undefined;
  }
  return hasInteractiveDescendants({ element, context }) ? "navigation" : undefined;
};

const isDecorativeImageElement = (element: ScreenElementIR): boolean => {
  const normalizedName = normalizeInputSemanticText(element.name);
  if (!normalizedName) {
    return false;
  }
  const hasDecorativeHint = A11Y_IMAGE_DECORATIVE_HINTS.some((hint) => normalizedName.includes(hint));
  if (hasDecorativeHint) {
    return true;
  }
  return !toA11yHumanizedLabel(element.name);
};

const isDecorativeElement = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type === "divider" || element.type === "skeleton") {
    return true;
  }
  if (element.type === "image") {
    return isDecorativeImageElement(element);
  }
  if ((isIconLikeNode(element) || isSemanticIconWrapper(element)) && !hasMeaningfulTextDescendants({ element, context })) {
    return true;
  }
  if (A11Y_INTERACTIVE_TYPES.has(element.type)) {
    return false;
  }
  return !hasMeaningfulTextDescendants({ element, context }) && !hasInteractiveDescendants({ element, context });
};

const inferHeadingComponentByNodeId = (elements: ScreenElementIR[]): Map<string, HeadingComponent> => {
  const headingCandidates = elements
    .flatMap((element) => collectTextNodes(element))
    .filter((node) => {
      const normalizedName = normalizeInputSemanticText(node.name);
      const hasHeadingHint = HEADING_NAME_HINTS.some((hint) => normalizedName.includes(hint));
      const fontSize = typeof node.fontSize === "number" ? node.fontSize : 0;
      const fontWeight = typeof node.fontWeight === "number" ? node.fontWeight : 0;
      return hasHeadingHint || fontSize >= 20 || fontWeight >= 650;
    })
    .sort((left, right) => {
      const leftFontSize = typeof left.fontSize === "number" ? left.fontSize : 0;
      const rightFontSize = typeof right.fontSize === "number" ? right.fontSize : 0;
      if (leftFontSize !== rightFontSize) {
        return rightFontSize - leftFontSize;
      }
      const leftWeight = typeof left.fontWeight === "number" ? left.fontWeight : 0;
      const rightWeight = typeof right.fontWeight === "number" ? right.fontWeight : 0;
      if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight;
      }
      return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || left.id.localeCompare(right.id);
    });

  const byNodeId = new Map<string, HeadingComponent>();
  const levelByIndex: HeadingComponent[] = ["h1", "h2", "h3", "h4", "h5", "h6"];
  for (const candidate of headingCandidates) {
    if (byNodeId.has(candidate.id)) {
      continue;
    }
    const nextLevel = levelByIndex[byNodeId.size];
    if (!nextLevel) {
      break;
    }
    byNodeId.set(candidate.id, nextLevel);
  }
  return byNodeId;
};

const resolveBackgroundHexForText = ({
  parent,
  context
}: {
  parent: VirtualParent;
  context: RenderContext;
}): string | undefined => {
  const normalizedParentColor = normalizeHexColor(parent.fillColor);
  if (normalizedParentColor) {
    return normalizedParentColor;
  }
  return (
    context.pageBackgroundColorNormalized ??
    normalizeHexColor(context.tokens?.palette.background)
  );
};

const pushLowContrastWarning = ({
  context,
  element,
  foreground,
  background,
  contrastRatio
}: {
  context: RenderContext;
  element: ScreenElementIR;
  foreground: string;
  background: string;
  contrastRatio: number;
}): void => {
  const warningKey = `${element.id}:${foreground}:${background}`;
  if (context.emittedAccessibilityWarningKeys.has(warningKey)) {
    return;
  }
  context.emittedAccessibilityWarningKeys.add(warningKey);
  const ratioLiteral = `${Math.round(contrastRatio * 100) / 100}:1`;
  context.accessibilityWarnings.push({
    code: "W_A11Y_LOW_CONTRAST",
    screenId: context.screenId,
    screenName: context.screenName,
    nodeId: element.id,
    nodeName: element.name,
    message: `Low contrast (${ratioLiteral}) for text node '${element.name}' on screen '${context.screenName}'`,
    foreground,
    background,
    contrastRatio: Math.round(contrastRatio * 1000) / 1000
  });
};

const pickBestIconNode = (element: ScreenElementIR): ScreenElementIR | undefined => {
  const candidates = collectIconNodes(element);
  const sorted = [...candidates].sort((left, right) => {
    const score = (candidate: ScreenElementIR): number => {
      const lowered = candidate.name.toLowerCase();
      let total = 0;
      if (lowered.startsWith("ic_")) {
        total += 6;
      }
      if (lowered.startsWith("icon/") || lowered.startsWith("icons/") || lowered.startsWith("icon-") || lowered.startsWith("icon_")) {
        total += 5;
      }
      if (lowered.includes("muisvgiconroot")) {
        total += 4;
      }
      if (lowered.includes("iconcomponent")) {
        total += 2;
      }
      if (collectVectorPaths(candidate).length > 0) {
        total += 8;
      }
      total -= Math.min(4, candidate.children?.length ?? 0);
      return total;
    };

    return (
      score(right) - score(left) ||
      ((left.width ?? 0) * (left.height ?? 0)) - ((right.width ?? 0) * (right.height ?? 0)) ||
      left.name.localeCompare(right.name)
    );
  });
  return sorted[0];
};

const hasSubtreeName = (element: ScreenElementIR, pattern: string): boolean => {
  if (element.name.toLowerCase().includes(pattern.toLowerCase())) {
    return true;
  }
  return (element.children ?? []).some((child) => hasSubtreeName(child, pattern));
};

const findFirstByName = (element: ScreenElementIR, pattern: string): ScreenElementIR | undefined => {
  if (element.name.toLowerCase().includes(pattern.toLowerCase())) {
    return element;
  }
  for (const child of element.children ?? []) {
    const nested = findFirstByName(child, pattern);
    if (nested) {
      return nested;
    }
  }
  return undefined;
};

interface SemanticIconModel {
  paths: string[];
  color?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

type TextFieldInputType = "email" | "password" | "tel" | "number" | "date" | "url" | "search";

interface SemanticInputModel {
  labelNode?: ScreenElementIR | undefined;
  valueNode?: ScreenElementIR | undefined;
  placeholderNode?: ScreenElementIR | undefined;
  labelIcon?: SemanticIconModel | undefined;
  suffixText?: string | undefined;
  suffixIcon?: SemanticIconModel | undefined;
  isSelect: boolean;
}

interface InteractiveFieldModel {
  key: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  isSelect: boolean;
  options: string[];
  inputType?: TextFieldInputType | undefined;
  autoComplete?: string | undefined;
  required?: boolean | undefined;
  validationType?: ValidationFieldType | undefined;
  validationMessage?: string | undefined;
  hasVisualErrorExample?: boolean | undefined;
  suffixText?: string | undefined;
  labelFontFamily?: string | undefined;
  labelColor?: string | undefined;
  valueFontFamily?: string | undefined;
  valueColor?: string | undefined;
}

interface InteractiveAccordionModel {
  key: string;
  defaultExpanded: boolean;
}

interface InteractiveTabsModel {
  elementId: string;
  stateId: number;
}

interface InteractiveDialogModel {
  elementId: string;
  stateId: number;
}

interface IconImportSpec {
  localName: string;
  modulePath: string;
}

interface IconFallbackMapEntry {
  iconName: string;
  aliases?: string[] | undefined;
}

interface IconFallbackMap {
  version: number;
  entries: IconFallbackMapEntry[];
  synonyms?: Record<string, string> | undefined;
}

interface CompiledIconFallbackEntry {
  iconName: string;
  aliases: string[];
  importSpec: IconImportSpec;
  priority: number;
}

interface IconFallbackResolver {
  entries: CompiledIconFallbackEntry[];
  byIconName: Map<string, CompiledIconFallbackEntry>;
  exactAliasMap: Map<string, CompiledIconFallbackEntry>;
  tokenIndex: Map<string, CompiledIconFallbackEntry[]>;
  synonymMap: Map<string, CompiledIconFallbackEntry>;
}

interface MappedImportSpec {
  localName: string;
  modulePath: string;
}

interface RenderedButtonModel {
  key: string;
  preferredSubmit: boolean;
  eligibleForSubmit: boolean;
}

interface RenderContext {
  screenId: string;
  screenName: string;
  generationLocale: string;
  fields: InteractiveFieldModel[];
  accordions: InteractiveAccordionModel[];
  tabs: InteractiveTabsModel[];
  dialogs: InteractiveDialogModel[];
  buttons: RenderedButtonModel[];
  activeRenderElements: Set<ScreenElementIR>;
  renderNodeVisitCount: number;
  interactiveDescendantCache: Map<string, boolean>;
  meaningfulTextDescendantCache: Map<string, boolean>;
  headingComponentByNodeId: Map<string, HeadingComponent>;
  typographyVariantByNodeId: Map<string, DesignTokenTypographyVariantName>;
  accessibilityWarnings: AccessibilityWarning[];
  muiImports: Set<string>;
  iconImports: IconImportSpec[];
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  usesRouterLink: boolean;
  usesNavigateHandler: boolean;
  prototypeNavigationRenderedCount: number;
  mappedImports: MappedImportSpec[];
  spacingBase: number;
  tokens?: DesignTokens | undefined;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  emittedWarningKeys: Set<string>;
  emittedAccessibilityWarningKeys: Set<string>;
  pageBackgroundColorNormalized: string | undefined;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}

const isValidJsIdentifier = (value: string): boolean => {
  return /^[A-Za-z_$][\w$]*$/.test(value);
};

const registerMuiImports = (context: RenderContext, ...imports: string[]): void => {
  for (const item of imports) {
    if (!item.trim()) {
      continue;
    }
    context.muiImports.add(item);
  }
};

const toIdentifier = (rawValue: string, fallback = "MappedComponent"): string => {
  const sanitized = rawValue.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^(\d)/, "_$1");
  if (isValidJsIdentifier(sanitized)) {
    return sanitized;
  }
  return fallback;
};

const toComponentIdentifier = (rawName: string): string => {
  const normalized = rawName
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return isValidJsIdentifier(normalized) ? normalized : "MappedComponent";
};

const pushMappingWarning = ({
  context,
  code,
  nodeId,
  message
}: {
  context: RenderContext;
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  nodeId: string;
  message: string;
}): void => {
  const key = `${code}:${nodeId}`;
  if (context.emittedWarningKeys.has(key)) {
    return;
  }
  context.emittedWarningKeys.add(key);
  context.mappingWarnings.push({
    code,
    nodeId,
    message
  });
};

const toContractExpression = (value: unknown): string => {
  if (typeof value === "string") {
    return literal(value);
  }
  return JSON.stringify(value);
};

const dedupeMappingWarnings = (
  warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>
): Array<{
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  message: string;
}> => {
  const seen = new Set<string>();
  const deduped: typeof warnings = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
};

const resolveContractValue = (value: unknown, element: ScreenElementIR): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  if (value === "{{nodeId}}") {
    return element.id;
  }
  if (value === "{{nodeName}}") {
    return element.name;
  }
  if (value === "{{text}}") {
    return firstText(element) ?? "";
  }
  return value;
};

const registerMappedImport = ({ context, mapping }: { context: RenderContext; mapping: ComponentMappingRule }): string => {
  const preferredName = toComponentIdentifier(mapping.componentName);
  const existing = context.mappedImports.find((item) => item.localName === preferredName && item.modulePath === mapping.importPath);
  if (existing) {
    return existing.localName;
  }

  const existingByModule = context.mappedImports.find((item) => item.modulePath === mapping.importPath);
  if (existingByModule) {
    return existingByModule.localName;
  }

  const knownNames = new Set<string>([
    ...context.muiImports,
    ...context.iconImports.map((item) => item.localName),
    ...context.mappedImports.map((item) => item.localName)
  ]);

  let localName = preferredName;
  let suffix = 2;
  while (knownNames.has(localName)) {
    localName = `${preferredName}${suffix}`;
    suffix += 1;
  }

  context.mappedImports.push({
    localName: toIdentifier(localName, "MappedComponent"),
    modulePath: mapping.importPath
  });
  const newestImport = context.mappedImports.at(-1);
  return newestImport?.localName ?? "MappedComponent";
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const renderMappedElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | undefined => {
  const mapping = context.mappingByNodeId.get(element.id);
  if (!mapping) {
    return undefined;
  }

  if (!mapping.enabled) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_DISABLED",
      nodeId: element.id,
      message: `Component mapping disabled for node '${element.id}', deterministic fallback used`
    });
    return undefined;
  }

  if (!mapping.importPath.trim() || !mapping.componentName.trim()) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Component mapping for node '${element.id}' is missing componentName/importPath, deterministic fallback used`
    });
    return undefined;
  }

  if (mapping.propContract !== undefined && !isPlainRecord(mapping.propContract)) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Component mapping contract for node '${element.id}' is not an object, deterministic fallback used`
    });
    return undefined;
  }

  const componentName = registerMappedImport({ context, mapping });
  context.usedMappingNodeIds.add(element.id);
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const resolvedContract = mapping.propContract ?? {};
  const childrenValue = resolveContractValue(resolvedContract.children, element);
  const propEntries = Object.entries(resolvedContract)
    .filter(([key]) => key !== "children")
    .map(([key, value]) => `${key}={${toContractExpression(resolveContractValue(value, element))}}`);

  const props = [`data-figma-node-id={${literal(element.id)}}`, `sx={{ ${sx} }}`, ...propEntries].join(" ");
  if (childrenValue !== undefined) {
    return `${indent}<${componentName} ${props}>{${toContractExpression(childrenValue)}}</${componentName}>`;
  }

  const implicitText = firstText(element);
  if (implicitText) {
    return `${indent}<${componentName} ${props}>{${literal(implicitText)}}</${componentName}>`;
  }

  return `${indent}<${componentName} ${props} />`;
};

const toStateKey = (element: ScreenElementIR): string => {
  const source = `${element.name}_${element.id}`.toLowerCase();
  const normalized = source.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "field";
};

const ensureTabsStateModel = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): InteractiveTabsModel => {
  const existing = context.tabs.find((candidate) => candidate.elementId === element.id);
  if (existing) {
    return existing;
  }
  const created: InteractiveTabsModel = {
    elementId: element.id,
    stateId: context.tabs.length + 1
  };
  context.tabs.push(created);
  return created;
};

const ensureDialogStateModel = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): InteractiveDialogModel => {
  const existing = context.dialogs.find((candidate) => candidate.elementId === element.id);
  if (existing) {
    return existing;
  }
  const created: InteractiveDialogModel = {
    elementId: element.id,
    stateId: context.dialogs.length + 1
  };
  context.dialogs.push(created);
  return created;
};

const escapeRegExpToken = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface LocaleNumberFormatSpec {
  decimalSymbol: string;
  separatorSymbols: Set<string>;
  separatorPattern: RegExp;
}

const localeNumberFormatSpecCache = new Map<string, LocaleNumberFormatSpec>();

const isLikelyGroupingPattern = ({
  value,
  separator
}: {
  value: string;
  separator: string;
}): boolean => {
  if (separator.length !== 1) {
    return false;
  }
  const segments = value.split(separator);
  if (segments.length <= 1 || segments.some((segment) => segment.length === 0)) {
    return false;
  }
  const [first, ...rest] = segments;
  if (!first || first.length < 1 || first.length > 3) {
    return false;
  }
  return rest.every((segment) => segment.length === 3);
};

const getLocaleNumberFormatSpec = (locale: string): LocaleNumberFormatSpec => {
  const cached = localeNumberFormatSpecCache.get(locale);
  if (cached) {
    return cached;
  }

  const parts = new Intl.NumberFormat(locale).formatToParts(1_234_567.89);
  const decimalSymbol = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const separators = new Set<string>([".", ",", "'", "’", " ", "\u00A0", "\u202F", decimalSymbol]);
  for (const part of parts) {
    if (part.type === "group" && part.value.length > 0) {
      separators.add(part.value);
    }
  }
  const separatorPattern = new RegExp([...separators].map((symbol) => escapeRegExpToken(symbol)).join("|"), "g");
  const spec: LocaleNumberFormatSpec = {
    decimalSymbol,
    separatorSymbols: separators,
    separatorPattern
  };
  localeNumberFormatSpecCache.set(locale, spec);
  return spec;
};

const parseLocalizedNumber = (value: string, locale: string): number | undefined => {
  const { decimalSymbol, separatorPattern, separatorSymbols } = getLocaleNumberFormatSpec(locale);
  const compactRaw = value.replace(/[\s\u00A0\u202F]/g, "").replace(/[−﹣－]/g, "-");
  const compact = [...compactRaw]
    .filter((character) => /\d/.test(character) || character === "+" || character === "-" || separatorSymbols.has(character))
    .join("");
  if (!compact || !/\d/.test(compact)) {
    return undefined;
  }

  const sign = compact.startsWith("-") ? "-" : compact.startsWith("+") ? "+" : "";
  const unsigned = compact.slice(sign.length).replace(/[+-]/g, "");
  if (!/\d/.test(unsigned)) {
    return undefined;
  }

  let decimalIndex = -1;
  if (decimalSymbol.length === 1 && unsigned.includes(decimalSymbol)) {
    decimalIndex = unsigned.lastIndexOf(decimalSymbol);
  } else {
    const fallbackSeparators = [".", ","].filter((symbol) => symbol !== decimalSymbol && unsigned.includes(symbol));
    if (fallbackSeparators.length === 1) {
      const separator = fallbackSeparators[0];
      decimalIndex = separator
        ? isLikelyGroupingPattern({ value: unsigned, separator })
          ? -1
          : unsigned.lastIndexOf(separator)
        : -1;
    } else if (fallbackSeparators.length > 1) {
      decimalIndex = Math.max(...fallbackSeparators.map((symbol) => unsigned.lastIndexOf(symbol)));
    }
  }

  const normalized =
    decimalIndex >= 0
      ? (() => {
          const integerPart = unsigned.slice(0, decimalIndex).replace(separatorPattern, "");
          const fractionPart = unsigned.slice(decimalIndex + 1).replace(separatorPattern, "");
          if (integerPart.length === 0 && fractionPart.length === 0) {
            return "";
          }
          return `${sign}${integerPart.length > 0 ? integerPart : "0"}${fractionPart.length > 0 ? `.${fractionPart}` : ""}`;
        })()
      : (() => {
          const integerPart = unsigned.replace(separatorPattern, "");
          if (integerPart.length === 0) {
            return "";
          }
          return `${sign}${integerPart}`;
        })();

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatLocalizedNumber = (value: number, fractionDigits = 2, locale: string): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(safe);
};

const deriveSelectOptions = (defaultValue: string, generationLocale: string): string[] => {
  const trimmed = defaultValue.trim();
  if (!trimmed) {
    return ["Option 1", "Option 2", "Option 3"];
  }

  if (/jahr/i.test(trimmed)) {
    const match = trimmed.match(/(\d+)/);
    const base = match ? Number(match[1]) : undefined;
    if (typeof base === "number" && Number.isFinite(base)) {
      return [...new Set([Math.max(1, base - 5), base, base + 5].map((value) => `${value} Jahre`))];
    }
  }

  if (trimmed.includes("%")) {
    const parsed = parseLocalizedNumber(trimmed, generationLocale);
    if (typeof parsed === "number") {
      const deltas = [-0.25, 0, 0.25];
      return [
        ...new Set(deltas.map((delta) => `${formatLocalizedNumber(Math.max(0, parsed + delta), 2, generationLocale)} %`))
      ];
    }
  }

  const parsed = parseLocalizedNumber(trimmed, generationLocale);
  if (typeof parsed === "number") {
    const deltas = [-0.1, 0, 0.1];
    return [
      ...new Set(
        deltas.map((delta) => {
          const value = parsed * (1 + delta);
          return formatLocalizedNumber(Math.max(0, value), 2, generationLocale);
        })
      )
    ];
  }

  return [trimmed, `${trimmed} A`, `${trimmed} B`];
};

const INPUT_NAME_HINTS = [
  "muiformcontrolroot",
  "muioutlinedinputroot",
  "muiinputbaseroot",
  "muiinputbaseinput",
  "muiinputroot",
  "muiselectselect",
  "textfield"
];
const TEXT_FIELD_TYPE_RULES: Array<{
  type: TextFieldInputType;
  patterns: RegExp[];
}> = [
  {
    type: "password",
    patterns: [/\bpassword\b/, /\bpasswort\b/, /\bkennwort\b/]
  },
  {
    type: "email",
    patterns: [/\be\s*mail\b/, /\bemail\b/, /\bmail\b/]
  },
  {
    type: "tel",
    patterns: [/\bphone\b/, /\btelefon\b/, /\btel\b/]
  },
  {
    type: "url",
    patterns: [/\burl\b/, /\bwebsite\b/, /\blink\b/]
  },
  {
    type: "number",
    patterns: [/\bnumber\b/, /\bamount\b/, /\bbetrag\b/, /\banzahl\b/]
  },
  {
    type: "date",
    patterns: [/\bdate\b/, /\bdatum\b/, /\bbirthday\b/, /\bgeburtstag\b/]
  },
  {
    type: "search",
    patterns: [/\bsearch\b/, /\bsuche\b/]
  }
];

const INPUT_PLACEHOLDER_TECHNICAL_VALUES = new Set([
  "swap component",
  "instance swap",
  "add description",
  "alternativtext"
]);
const INPUT_PLACEHOLDER_GENERIC_PATTERNS = [
  /^(type|enter|your)(?:\s+text)?(?:\s+here)?$/i,
  /^(label|title|subtitle|heading)$/i,
  /^(xx(?:[./:-]xx)+)$/i,
  /^\$?\s*0(?:[.,]0{2})?$/i,
  /^\d{3}-\d{3}-\d{4}$/i,
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i,
  /^(john|jane)\s+doe$/i,
  /^[x•—–-]$/i
];

const ACCORDION_NAME_HINTS = ["accordion", "accordionsummarycontent", "collapsewrapper"];

const hasAnySubtreeName = (element: ScreenElementIR, patterns: string[]): boolean => {
  return patterns.some((pattern) => hasSubtreeName(element, pattern));
};

const isValueLikeText = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /\d/.test(trimmed) || trimmed.includes("%") || trimmed.includes("€") || /jahr/i.test(trimmed);
};

const normalizeInputPlaceholderText = (value: string): string => {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
};

const normalizeInputSemanticText = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_./:-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const collectInputSemanticHints = ({
  element,
  label,
  placeholder
}: {
  element: ScreenElementIR;
  label: string;
  placeholder: string | undefined;
}): string[] => {
  const uniqueHints = new Set<string>();
  const rawHints = [label, placeholder, ...collectSubtreeNames(element)];
  for (const value of rawHints) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeInputSemanticText(value);
    if (!normalized) {
      continue;
    }
    uniqueHints.add(normalized);
  }
  return Array.from(uniqueHints);
};

const inferTextFieldType = (hints: string[]): TextFieldInputType | undefined => {
  for (const rule of TEXT_FIELD_TYPE_RULES) {
    if (hints.some((hint) => rule.patterns.some((pattern) => pattern.test(hint)))) {
      return rule.type;
    }
  }
  return undefined;
};

const inferTextFieldAutoComplete = (inputType: TextFieldInputType | undefined): string | undefined => {
  switch (inputType) {
    case "email":
      return "email";
    case "password":
      return "current-password";
    case "tel":
      return "tel";
    case "url":
      return "url";
    default:
      return undefined;
  }
};

const inferRequiredFromLabel = (label: string): boolean => {
  return /(?:^|\s)\*(?:\s|$)|\*\s*$/.test(label);
};

const sanitizeRequiredLabel = (label: string): string => {
  return label.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ").trim();
};

const inferTextFieldValidationMessage = (validationType: ValidationFieldType | undefined): string | undefined => {
  switch (validationType) {
    case "email":
      return "Please enter a valid email address.";
    case "tel":
      return "Please enter a valid phone number.";
    case "url":
      return "Please enter a valid URL.";
    case "number":
      return "Please enter a valid number.";
    case "date":
      return "Please enter a valid date (YYYY-MM-DD).";
    default:
      return undefined;
  }
};

const inferVisualErrorFromOutline = (element: ScreenElementIR): boolean => {
  const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineColor = toRgbaColor(outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor ?? element.strokeColor);
  return isLikelyErrorRedColor(outlineColor);
};

const isLikelyInputPlaceholderText = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeInputPlaceholderText(value);
  if (!normalized) {
    return false;
  }
  if (INPUT_PLACEHOLDER_TECHNICAL_VALUES.has(normalized)) {
    return true;
  }
  return INPUT_PLACEHOLDER_GENERIC_PATTERNS.some((pattern) => pattern.test(normalized));
};

const splitTextRows = (texts: ScreenElementIR[]): { topRow: ScreenElementIR[]; bottomRow: ScreenElementIR[] } => {
  if (texts.length === 0) {
    return { topRow: [], bottomRow: [] };
  }
  if (texts.length === 1) {
    const single = texts[0];
    return single ? { topRow: [single], bottomRow: [] } : { topRow: [], bottomRow: [] };
  }
  const sortedByY = [...texts].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const first = sortedByY[0];
  const last = sortedByY[sortedByY.length - 1];
  if (!first || !last) {
    return { topRow: [], bottomRow: [] };
  }
  const minY = first.y ?? 0;
  const maxY = last.y ?? 0;
  const midpoint = (minY + maxY) / 2;
  const topRow = sortedByY.filter((node) => (node.y ?? 0) <= midpoint);
  const bottomRow = sortedByY.filter((node) => (node.y ?? 0) > midpoint);
  if (topRow.length > 0 && bottomRow.length > 0) {
    return { topRow, bottomRow };
  }
  return { topRow: sortedByY.slice(0, 1), bottomRow: sortedByY.slice(1) };
};

const isLikelyInputContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }

  const hasDirectVisualContainer = Boolean(
    element.strokeColor || element.fillColor || element.fillGradient || (element.cornerRadius ?? 0) > 0
  );
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const sizeLooksLikeField = width >= 120 && height >= 36 && height <= 120;
  const hasInputSemantics = hasAnySubtreeName(element, INPUT_NAME_HINTS);

  const texts = collectTextNodes(element).filter((node) => (node.text?.trim() ?? "").length > 0);
  const { topRow, bottomRow } = splitTextRows(texts);
  const hasLabelValuePattern =
    topRow.some((node) => !isValueLikeText(node.text ?? "")) && bottomRow.some((node) => isValueLikeText(node.text ?? ""));

  if (hasInputSemantics && sizeLooksLikeField) {
    return true;
  }

  return hasDirectVisualContainer && sizeLooksLikeField && hasLabelValuePattern;
};

const isLikelyAccordionContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  return hasAnySubtreeName(element, ACCORDION_NAME_HINTS) && hasSubtreeName(element, "collapsewrapper");
};

const normalizeIconImports = (iconImports: IconImportSpec[]): IconImportSpec[] => {
  const seen = new Set<string>();
  const uniqueIconImports: IconImportSpec[] = [];

  for (const iconImport of iconImports) {
    const dedupeKey = `${iconImport.localName}:::${iconImport.modulePath}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    uniqueIconImports.push(iconImport);
  }

  return uniqueIconImports.sort((left, right) => {
    const modulePathComparison = left.modulePath.localeCompare(right.modulePath);
    if (modulePathComparison !== 0) {
      return modulePathComparison;
    }
    return left.localName.localeCompare(right.localName);
  });
};

const registerIconImport = (context: RenderContext, spec: IconImportSpec): string => {
  const exists = context.iconImports.some(
    (icon) => icon.localName === spec.localName && icon.modulePath === spec.modulePath
  );
  if (!exists) {
    context.iconImports.push(spec);
  }
  return spec.localName;
};

const resolveIconColor = (element: ScreenElementIR): string | undefined => {
  return firstVectorColor(element) ?? firstTextColor(element) ?? element.fillColor;
};

const ICON_FALLBACK_FILE_NAME = "icon-fallback-map.json";
const ICON_FALLBACK_DEFAULT_IMPORT_SPEC: IconImportSpec = {
  localName: "InfoOutlinedIcon",
  modulePath: "@mui/icons-material/InfoOutlined"
};
const ICON_FALLBACK_STYLE_TOKENS = new Set(["outlined", "rounded", "sharp", "twotone", "two", "tone", "filled"]);
const ICON_FALLBACK_MAX_PHRASE_LENGTH = 3;
const ICON_FALLBACK_FUZZY_STOPWORDS = new Set(["icon", "icons", "name", "real"]);

const normalizeIconLookupText = (value: string): string => {
  return normalizeInputSemanticText(value);
};

const toIconNameTokens = (iconName: string): string[] => {
  return iconName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0);
};

const toIconImportSpec = (iconName: string): IconImportSpec => {
  return {
    localName: `${iconName}Icon`,
    modulePath: `@mui/icons-material/${iconName}`
  };
};

const isValidIconName = (value: string): boolean => {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(value);
};

const toGeneratedAliasesForIconName = (iconName: string): string[] => {
  const rawTokens = toIconNameTokens(iconName);
  if (rawTokens.length === 0) {
    return [];
  }
  const baseTokens = rawTokens.filter((token) => !ICON_FALLBACK_STYLE_TOKENS.has(token));
  const aliases = new Set<string>();
  const pushAlias = (candidate: string): void => {
    const normalized = normalizeIconLookupText(candidate);
    if (normalized.length > 0) {
      aliases.add(normalized);
    }
  };
  pushAlias(rawTokens.join(" "));
  if (baseTokens.length > 0) {
    pushAlias(baseTokens.join(" "));
  }
  if (baseTokens.length === 1) {
    pushAlias(baseTokens[0] ?? "");
  }
  return Array.from(aliases).sort((left, right) => left.localeCompare(right));
};

const buildIconFallbackMapFilePayload = (map: IconFallbackMap): IconFallbackMap => {
  return {
    version: ICON_FALLBACK_MAP_VERSION,
    entries: map.entries.map((entry) => ({
      iconName: entry.iconName,
      aliases: Array.from(
        new Set([
          ...toGeneratedAliasesForIconName(entry.iconName),
          ...(entry.aliases ?? []).map((alias) => normalizeIconLookupText(alias))
        ])
      ).filter((alias) => alias.length > 0)
    })),
    ...(map.synonyms ? { synonyms: map.synonyms } : {})
  };
};

const toUniqueAliasList = ({
  iconName,
  aliases
}: {
  iconName: string;
  aliases?: string[] | undefined;
}): string[] => {
  const unique = new Set<string>();
  for (const alias of [...toGeneratedAliasesForIconName(iconName), ...(aliases ?? [])]) {
    const normalized = normalizeIconLookupText(alias);
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).sort((left, right) => left.localeCompare(right));
};

const compileIconFallbackResolver = ({ map }: { map: IconFallbackMap }): IconFallbackResolver => {
  const entries: CompiledIconFallbackEntry[] = [];
  const byIconName = new Map<string, CompiledIconFallbackEntry>();

  for (const [index, entry] of map.entries.entries()) {
    if (!isValidIconName(entry.iconName)) {
      continue;
    }
    const aliases = toUniqueAliasList({
      iconName: entry.iconName,
      ...(entry.aliases ? { aliases: entry.aliases } : {})
    });
    if (aliases.length === 0) {
      continue;
    }
    const compiled: CompiledIconFallbackEntry = {
      iconName: entry.iconName,
      aliases,
      importSpec: toIconImportSpec(entry.iconName),
      priority: index
    };
    entries.push(compiled);
    if (!byIconName.has(compiled.iconName)) {
      byIconName.set(compiled.iconName, compiled);
    }
  }

  const exactAliasMap = new Map<string, CompiledIconFallbackEntry>();
  const tokenIndex = new Map<string, CompiledIconFallbackEntry[]>();

  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const existing = exactAliasMap.get(alias);
      if (
        !existing ||
        entry.priority < existing.priority ||
        (entry.priority === existing.priority && entry.iconName.localeCompare(existing.iconName) < 0)
      ) {
        exactAliasMap.set(alias, entry);
      }
      for (const token of alias.split(" ")) {
        if (!token) {
          continue;
        }
        const bucket = tokenIndex.get(token);
        if (!bucket) {
          tokenIndex.set(token, [entry]);
          continue;
        }
        if (!bucket.some((candidate) => candidate.iconName === entry.iconName)) {
          bucket.push(entry);
        }
      }
    }
  }

  const synonymMap = new Map<string, CompiledIconFallbackEntry>();
  const synonyms = map.synonyms ?? {};
  const orderedSynonymEntries = Object.entries(synonyms).sort(([left], [right]) => left.localeCompare(right));
  for (const [rawSynonym, iconName] of orderedSynonymEntries) {
    const normalizedSynonym = normalizeIconLookupText(rawSynonym);
    if (!normalizedSynonym) {
      continue;
    }
    const entry = byIconName.get(iconName);
    if (!entry) {
      continue;
    }
    if (!synonymMap.has(normalizedSynonym)) {
      synonymMap.set(normalizedSynonym, entry);
    }
  }

  for (const bucket of tokenIndex.values()) {
    bucket.sort((left, right) => left.priority - right.priority || left.iconName.localeCompare(right.iconName));
  }

  return {
    entries,
    byIconName,
    exactAliasMap,
    tokenIndex,
    synonymMap
  };
};

const ICON_FALLBACK_ALIAS_OVERRIDES: Record<string, string[]> = {
  BookmarkBorder: ["bookmark outline", "bookmark_outline", "bookmark outlined", "merken"],
  HelpOutline: ["questionmark", "hilfe"],
  HomeOutlined: ["homepage", "startseite"],
  PersonSearch: ["personensuche", "person_search", "search_person", "search person", "person search"],
  Forum: ["messenger", "speechbubble", "speech_bubble", "speech bubble"],
  Folder: ["document", "two documents", "two_documents"],
  EditOutlined: ["pencil"],
  Delete: ["trash"],
  Mail: ["postbox"],
  Add: ["plus"],
  Search: ["magnifier"],
  InfoOutlined: ["hint", "info hint", "info_hint"]
};

const ICON_FALLBACK_BUILTIN_MAP: IconFallbackMap = {
  version: ICON_FALLBACK_MAP_VERSION,
  entries: BUILTIN_ICON_FALLBACK_CATALOG.entries.map((entry) => ({
    iconName: entry.iconName,
    ...(ICON_FALLBACK_ALIAS_OVERRIDES[entry.iconName] ? { aliases: ICON_FALLBACK_ALIAS_OVERRIDES[entry.iconName] } : {})
  })),
  synonyms: BUILTIN_ICON_FALLBACK_CATALOG.synonyms
};

const ICON_FALLBACK_BUILTIN_RESOLVER = compileIconFallbackResolver({
  map: ICON_FALLBACK_BUILTIN_MAP
});

const parseIconFallbackMapFile = ({ input }: { input: unknown }): IconFallbackMap | undefined => {
  if (!isPlainRecord(input)) {
    return undefined;
  }

  const version = input.version;
  if (version !== ICON_FALLBACK_MAP_VERSION) {
    return undefined;
  }

  const rawEntries = input.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return undefined;
  }

  const entries: IconFallbackMapEntry[] = [];
  for (const rawEntry of rawEntries) {
    if (!isPlainRecord(rawEntry)) {
      continue;
    }
    const iconName = typeof rawEntry.iconName === "string" ? rawEntry.iconName.trim() : "";
    if (!isValidIconName(iconName)) {
      continue;
    }
    const aliases =
      Array.isArray(rawEntry.aliases) && rawEntry.aliases.every((alias) => typeof alias === "string")
        ? rawEntry.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0)
        : undefined;
    entries.push({
      iconName,
      ...(aliases ? { aliases } : {})
    });
  }
  if (entries.length === 0) {
    return undefined;
  }

  let synonyms: Record<string, string> | undefined;
  if (isPlainRecord(input.synonyms)) {
    const normalizedSynonyms: Record<string, string> = {};
    for (const [rawSynonym, rawIconName] of Object.entries(input.synonyms)) {
      if (typeof rawIconName !== "string") {
        continue;
      }
      const synonym = rawSynonym.trim();
      const iconName = rawIconName.trim();
      if (!synonym || !isValidIconName(iconName)) {
        continue;
      }
      normalizedSynonyms[synonym] = iconName;
    }
    if (Object.keys(normalizedSynonyms).length > 0) {
      synonyms = normalizedSynonyms;
    }
  }

  return {
    version: ICON_FALLBACK_MAP_VERSION,
    entries,
    ...(synonyms ? { synonyms } : {})
  };
};

const loadIconFallbackResolver = async ({
  iconMapFilePath,
  onLog
}: {
  iconMapFilePath: string;
  onLog: (message: string) => void;
}): Promise<IconFallbackResolver> => {
  try {
    const rawContent = await readFile(iconMapFilePath, "utf8");
    const parsed = parseIconFallbackMapFile({
      input: JSON.parse(rawContent)
    });
    if (!parsed) {
      onLog(`Icon fallback map at '${iconMapFilePath}' is invalid; using built-in deterministic catalog.`);
      return ICON_FALLBACK_BUILTIN_RESOLVER;
    }
    return compileIconFallbackResolver({
      map: parsed
    });
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code !== "ENOENT") {
      onLog(`Failed to load icon fallback map at '${iconMapFilePath}': ${getErrorMessage(error)}; using built-in catalog.`);
      return ICON_FALLBACK_BUILTIN_RESOLVER;
    }

    const bootstrapPayload = buildIconFallbackMapFilePayload(ICON_FALLBACK_BUILTIN_MAP);
    try {
      await mkdir(path.dirname(iconMapFilePath), { recursive: true });
      await writeFile(iconMapFilePath, `${JSON.stringify(bootstrapPayload, null, 2)}\n`, "utf8");
      onLog(`Bootstrapped icon fallback map at '${iconMapFilePath}'.`);
    } catch (bootstrapError) {
      onLog(
        `Failed to bootstrap icon fallback map at '${iconMapFilePath}': ${getErrorMessage(bootstrapError)}; using built-in catalog.`
      );
    }
    return ICON_FALLBACK_BUILTIN_RESOLVER;
  }
};

const toIconInputTokens = (normalizedInput: string): string[] => {
  return normalizedInput.split(" ").filter((token) => token.length > 0);
};

const containsBoundaryAlias = ({ text, alias }: { text: string; alias: string }): boolean => {
  return text === alias || text.startsWith(`${alias} `) || text.endsWith(` ${alias}`) || text.includes(` ${alias} `);
};

const collectInputPhrases = ({ tokens }: { tokens: string[] }): string[] => {
  const phrases: string[] = [];
  for (let length = ICON_FALLBACK_MAX_PHRASE_LENGTH; length >= 1; length -= 1) {
    if (tokens.length < length) {
      continue;
    }
    for (let index = 0; index <= tokens.length - length; index += 1) {
      const phrase = tokens.slice(index, index + length).join(" ");
      if (!phrases.includes(phrase)) {
        phrases.push(phrase);
      }
    }
  }
  return phrases;
};

const toBoundedLevenshteinDistance = ({
  left,
  right,
  maxDistance
}: {
  left: string;
  right: string;
  maxDistance: number;
}): number | undefined => {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return undefined;
  }
  const previous = new Array<number>(right.length + 1).fill(0).map((_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let rowMin = row;
    for (let col = 1; col <= right.length; col += 1) {
      const deletion = previous[col]! + 1;
      const insertion = current[col - 1]! + 1;
      const substitution = previous[col - 1]! + (left[row - 1] === right[col - 1] ? 0 : 1);
      const nextValue = Math.min(deletion, insertion, substitution);
      current[col] = nextValue;
      rowMin = Math.min(rowMin, nextValue);
    }
    if (rowMin > maxDistance) {
      return undefined;
    }
    for (let col = 0; col <= right.length; col += 1) {
      previous[col] = current[col] ?? maxDistance + 1;
    }
  }

  const result = previous[right.length] ?? maxDistance + 1;
  return result <= maxDistance ? result : undefined;
};

const resolveFallbackIconByExactPhrase = ({
  normalizedInput,
  resolver
}: {
  normalizedInput: string;
  resolver: IconFallbackResolver;
}): CompiledIconFallbackEntry | undefined => {
  return resolver.exactAliasMap.get(normalizedInput);
};

const resolveFallbackIconByTokenBoundary = ({
  normalizedInput,
  tokens,
  resolver
}: {
  normalizedInput: string;
  tokens: string[];
  resolver: IconFallbackResolver;
}): CompiledIconFallbackEntry | undefined => {
  const candidateEntries = new Map<string, CompiledIconFallbackEntry>();
  for (const token of tokens) {
    for (const entry of resolver.tokenIndex.get(token) ?? []) {
      candidateEntries.set(entry.iconName, entry);
    }
  }
  const rankedCandidates: Array<{ entry: CompiledIconFallbackEntry; score: number }> = [];
  for (const entry of candidateEntries.values()) {
    let bestScore = 0;
    for (const alias of entry.aliases) {
      if (!containsBoundaryAlias({ text: normalizedInput, alias })) {
        continue;
      }
      const tokenScore = alias.split(" ").length;
      bestScore = Math.max(bestScore, tokenScore * 100 + alias.length);
    }
    if (bestScore > 0) {
      rankedCandidates.push({ entry, score: bestScore });
    }
  }
  if (rankedCandidates.length === 0) {
    return undefined;
  }
  rankedCandidates.sort((left, right) => {
    return (
      right.score - left.score ||
      left.entry.priority - right.entry.priority ||
      left.entry.iconName.localeCompare(right.entry.iconName)
    );
  });
  return rankedCandidates[0]?.entry;
};

const resolveFallbackIconBySynonym = ({
  tokens,
  resolver
}: {
  tokens: string[];
  resolver: IconFallbackResolver;
}): CompiledIconFallbackEntry | undefined => {
  for (const phrase of collectInputPhrases({ tokens })) {
    const match = resolver.synonymMap.get(phrase);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const resolveFallbackIconByFuzzyDistance = ({
  normalizedInput,
  tokens,
  resolver
}: {
  normalizedInput: string;
  tokens: string[];
  resolver: IconFallbackResolver;
}): CompiledIconFallbackEntry | undefined => {
  const phraseTerms = normalizedInput.includes(" ") ? [] : [normalizedInput];
  const terms = [...new Set([...phraseTerms, ...tokens])]
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !ICON_FALLBACK_FUZZY_STOPWORDS.has(term));
  const candidates: Array<{ entry: CompiledIconFallbackEntry; distance: number; tokenScore: number }> = [];
  for (const entry of resolver.entries) {
    let bestDistance: number | undefined;
    let bestTokenScore = 0;
    for (const alias of entry.aliases) {
      for (const term of terms) {
        if (!term || Math.abs(alias.length - term.length) > 3) {
          continue;
        }
        const maxDistance = Math.max(1, Math.min(3, Math.floor(Math.min(alias.length, term.length) / 4)));
        const distance = toBoundedLevenshteinDistance({
          left: alias,
          right: term,
          maxDistance
        });
        if (distance === undefined) {
          continue;
        }
        const tokenScore = alias.split(" ").length;
        if (
          bestDistance === undefined ||
          distance < bestDistance ||
          (distance === bestDistance && tokenScore > bestTokenScore)
        ) {
          bestDistance = distance;
          bestTokenScore = tokenScore;
        }
      }
    }
    if (bestDistance !== undefined) {
      candidates.push({
        entry,
        distance: bestDistance,
        tokenScore: bestTokenScore
      });
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((left, right) => {
    return (
      left.distance - right.distance ||
      right.tokenScore - left.tokenScore ||
      left.entry.priority - right.entry.priority ||
      left.entry.iconName.localeCompare(right.entry.iconName)
    );
  });
  return candidates[0]?.entry;
};

const resolveIconImportSpecFromCatalog = ({
  rawInput,
  resolver
}: {
  rawInput: string;
  resolver: IconFallbackResolver;
}): IconImportSpec => {
  const normalizedInput = normalizeIconLookupText(rawInput);
  if (!normalizedInput) {
    return ICON_FALLBACK_DEFAULT_IMPORT_SPEC;
  }

  const tokens = toIconInputTokens(normalizedInput);
  const exact = resolveFallbackIconByExactPhrase({
    normalizedInput,
    resolver
  });
  if (exact) {
    return exact.importSpec;
  }

  const tokenBoundary = resolveFallbackIconByTokenBoundary({
    normalizedInput,
    tokens,
    resolver
  });
  if (tokenBoundary) {
    return tokenBoundary.importSpec;
  }

  const synonym = resolveFallbackIconBySynonym({
    tokens,
    resolver
  });
  if (synonym) {
    return synonym.importSpec;
  }

  const fuzzy = resolveFallbackIconByFuzzyDistance({
    normalizedInput,
    tokens,
    resolver
  });
  if (fuzzy) {
    return fuzzy.importSpec;
  }

  return ICON_FALLBACK_DEFAULT_IMPORT_SPEC;
};

const hasDownIndicatorHint = (subtreeNameBlob: string): boolean => {
  const normalized = normalizeIconLookupText(subtreeNameBlob);
  return (
    normalized.includes("expand more") ||
    normalized.includes("chevron down") ||
    normalized.includes("arrow drop down") ||
    normalized.includes("keyboard arrow down") ||
    normalized.includes("caret down") ||
    normalized.includes("ic down") ||
    /\bdown\b/.test(normalized)
  );
};

const resolveFallbackIconComponent = ({
  element,
  parent,
  context
}: {
  element: ScreenElementIR;
  parent: Pick<VirtualParent, "name">;
  context: RenderContext;
}): string => {
  const parentName = parent.name?.toLowerCase() ?? "";
  const subtreeNameBlob = collectSubtreeNames(element).join(" ");
  const normalizedSubtreeName = normalizeIconLookupText(subtreeNameBlob);

  const spec =
    parentName.includes("buttonendicon") ||
    normalizedSubtreeName.includes("chevron right") ||
    normalizedSubtreeName.includes("arrow right")
      ? {
          localName: "ChevronRightIcon",
          modulePath: "@mui/icons-material/ChevronRight"
        }
      : parentName.includes("expandiconwrapper") ||
          parentName.includes("outlinedinputroot") ||
          parentName.includes("formcontrolroot") ||
          parentName.includes("select") ||
          hasDownIndicatorHint(normalizedSubtreeName)
        ? {
            localName: "ExpandMoreIcon",
            modulePath: "@mui/icons-material/ExpandMore"
          }
        : parentName.includes("accordionsummarycontent")
          ? {
              localName: "TuneIcon",
              modulePath: "@mui/icons-material/Tune"
            }
          : resolveIconImportSpecFromCatalog({
              rawInput: subtreeNameBlob,
              resolver: context.iconResolver
            });

  return registerIconImport(context, spec);
};

const renderFallbackIconExpression = ({
  element,
  parent,
  context,
  ariaHidden = false,
  extraEntries = []
}: {
  element: ScreenElementIR;
  parent: Pick<VirtualParent, "name">;
  context: RenderContext;
  ariaHidden?: boolean;
  extraEntries?: Array<[string, string | number | undefined]>;
}): string => {
  const vectorPaths = collectVectorPaths(element);
  if (vectorPaths.length > 0) {
    return renderInlineSvgIcon({
      icon: {
        paths: vectorPaths,
        color: resolveIconColor(element),
        width: element.width,
        height: element.height
      },
      context,
      ariaHidden,
      extraEntries
    });
  }

  const iconComponent = resolveFallbackIconComponent({ element, parent, context });
  const color = resolveIconColor(element);
  const sx = sxString([
    ["width", toPxLiteral(element.width)],
    ["height", toPxLiteral(element.height)],
    ["fontSize", toPxLiteral(element.width ? Math.max(12, Math.round(element.width * 0.9)) : 16)],
    ["lineHeight", literal("1")],
    ["color", toThemeColorLiteral({ color, tokens: context.tokens })],
    ...extraEntries
  ]);
  const ariaHiddenProp = ariaHidden ? ` aria-hidden="true"` : "";
  return `<${iconComponent}${ariaHiddenProp} sx={{ ${sx} }} fontSize="inherit" />`;
};

const registerInteractiveField = ({
  context,
  element,
  model
}: {
  context: RenderContext;
  element: ScreenElementIR;
  model: SemanticInputModel;
}): InteractiveFieldModel => {
  const key = toStateKey(element);
  const existing = context.fields.find((field) => field.key === key);
  if (existing) {
    return existing;
  }

  const rawLabel = model.labelNode?.text?.trim() ?? element.name;
  const required = inferRequiredFromLabel(rawLabel);
  const sanitizedLabel = required ? sanitizeRequiredLabel(rawLabel) : rawLabel;
  const label = sanitizedLabel.length > 0 ? sanitizedLabel : rawLabel;
  const placeholder = model.placeholderNode?.text?.trim();
  const defaultValue = model.valueNode?.text?.trim() ?? "";
  const isSelect = model.isSelect;
  const options = isSelect ? deriveSelectOptions(defaultValue, context.generationLocale) : [];
  const semanticHints = isSelect ? [] : collectInputSemanticHints({ element, label, placeholder });
  const inputType = isSelect ? undefined : inferTextFieldType(semanticHints);
  const autoComplete = isSelect ? undefined : inferTextFieldAutoComplete(inputType);
  const validationType = isSelect ? undefined : inputType;
  const validationMessage = inferTextFieldValidationMessage(validationType);
  const hasVisualErrorExample = inferVisualErrorFromOutline(element);

  const created: InteractiveFieldModel = {
    key,
    label,
    defaultValue,
    ...(placeholder && !isSelect ? { placeholder } : {}),
    isSelect,
    options,
    ...(inputType ? { inputType } : {}),
    ...(autoComplete ? { autoComplete } : {}),
    ...(required ? { required } : {}),
    ...(validationType ? { validationType } : {}),
    ...(validationMessage ? { validationMessage } : {}),
    ...(hasVisualErrorExample ? { hasVisualErrorExample } : {}),
    suffixText: isSelect ? undefined : model.suffixText,
    labelFontFamily: normalizeFontFamily(model.labelNode?.fontFamily),
    labelColor: model.labelNode?.fillColor,
    valueFontFamily: normalizeFontFamily(model.valueNode?.fontFamily),
    valueColor: model.valueNode?.fillColor
  };
  context.fields.push(created);
  return created;
};

const registerInteractiveAccordion = ({
  context,
  element,
  defaultExpanded
}: {
  context: RenderContext;
  element: ScreenElementIR;
  defaultExpanded: boolean;
}): InteractiveAccordionModel => {
  const key = toStateKey(element);
  const existing = context.accordions.find((accordion) => accordion.key === key);
  if (existing) {
    return existing;
  }
  const created: InteractiveAccordionModel = {
    key,
    defaultExpanded
  };
  context.accordions.push(created);
  return created;
};

const buildSemanticInputModel = (element: ScreenElementIR): SemanticInputModel => {
  const texts = collectTextNodes(element).sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const iconNodes = collectIconNodes(element)
    .map((node) => ({
      node,
      paths: collectVectorPaths(node)
    }));
  const iconVectors = iconNodes.filter((candidate) => candidate.paths.length > 0);

  const isSuffixText = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed === "€" || trimmed === "%" || trimmed === "$";
  };
  const isPlaceholderNode = (node: ScreenElementIR): boolean => {
    if (node.textRole === "placeholder") {
      return true;
    }
    return isLikelyInputPlaceholderText(node.text);
  };

  const { topRow, bottomRow } = splitTextRows(texts);
  const placeholderNode =
    bottomRow.find((node) => isPlaceholderNode(node)) ?? texts.find((node) => isPlaceholderNode(node));
  const labelNode =
    topRow.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    }) ??
    texts.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    });

  const valueNode =
    bottomRow.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isSuffixText(text) && !isPlaceholderNode(node);
    }) ??
    texts.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && isValueLikeText(text) && !isSuffixText(text) && !isPlaceholderNode(node);
    });

  const labelIconNode =
    iconVectors.find((candidate) => {
      if (!labelNode) {
        return false;
      }
      const yDelta = Math.abs((candidate.node.y ?? 0) - (labelNode.y ?? 0));
      const isSmall = (candidate.node.width ?? 0) <= 16 && (candidate.node.height ?? 0) <= 16;
      const isOnLabelRow = yDelta <= 12;
      return isSmall && isOnLabelRow;
    }) ?? undefined;

  const rightBoundary = (element.x ?? 0) + (element.width ?? 0) * 0.62;
  const suffixTextNode = texts.find((node) => {
    const text = node.text?.trim() ?? "";
    return text.length > 0 && isSuffixText(text) && (node.x ?? 0) >= rightBoundary;
  });

  const suffixIconCandidate =
    iconNodes.find((candidate) => {
      const isRightSide = (candidate.node.x ?? 0) >= rightBoundary;
      const isNotLabelIcon = candidate.node.id !== labelIconNode?.node.id;
      return isRightSide && isNotLabelIcon;
    }) ?? undefined;

  const hasAdornment = hasSubtreeName(element, "inputadornmentroot");
  const isSelect = hasSubtreeName(element, "muiselectselect") || Boolean(suffixIconCandidate && !suffixTextNode);
  const suffixText = suffixTextNode?.text?.trim() ?? (hasAdornment && !suffixIconCandidate ? "€" : undefined);
  const suffixIconNode = suffixIconCandidate && suffixIconCandidate.paths.length > 0 ? suffixIconCandidate : undefined;

  return {
    labelNode,
    valueNode,
    placeholderNode,
    labelIcon: labelIconNode
      ? {
          paths: labelIconNode.paths,
          color: firstVectorColor(labelIconNode.node),
          width: labelIconNode.node.width,
          height: labelIconNode.node.height
        }
      : undefined,
    suffixText,
    suffixIcon: suffixIconNode
      ? {
          paths: suffixIconNode.paths,
          color: firstVectorColor(suffixIconNode.node),
          width: suffixIconNode.node.width,
          height: suffixIconNode.node.height
        }
      : undefined,
    isSelect
  };
};

const renderInlineSvgIcon = ({
  icon,
  context,
  ariaHidden = false,
  extraEntries = []
}: {
  icon: SemanticIconModel;
  context: RenderContext;
  ariaHidden?: boolean;
  extraEntries?: Array<[string, string | number | undefined]>;
}): string => {
  registerMuiImports(context, "SvgIcon");
  const sx = sxString([
    ["width", toPxLiteral(icon.width)],
    ["height", toPxLiteral(icon.height)],
    ["color", toThemeColorLiteral({ color: icon.color, tokens: context.tokens })],
    ...extraEntries
  ]);
  const width = Math.max(1, Math.round(icon.width ?? 24));
  const height = Math.max(1, Math.round(icon.height ?? 24));
  const paths = icon.paths.map((pathData) => `<path d={${literal(pathData)}} />`).join("");
  const ariaHiddenProp = ariaHidden ? ` aria-hidden="true"` : "";
  return `<SvgIcon${ariaHiddenProp} sx={{ ${sx} }} viewBox={${literal(`0 0 ${width} ${height}`)}}>${paths}</SvgIcon>`;
};

const renderSemanticInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineStrokeColor = outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor;
  const fieldSx = sxString([
    ...baseLayoutEntries(outlineContainer, parent, {
      includePaints: false,
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: outlineContainer.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[outlineContainer.id],
      spacingBase: context.spacingBase
    }),
    ["bgcolor", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })]
  ]);

  const inputRootStyle = sxString([
    [
      "borderRadius",
      toThemeBorderRadiusValue({
        radiusPx: outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius,
        tokens: context.tokens
      })
    ],
    ["fontFamily", field.valueFontFamily ? literal(field.valueFontFamily) : undefined],
    ["color", toThemeColorLiteral({ color: field.valueColor, tokens: context.tokens })]
  ]);
  const inputLabelStyle = sxString([
    ["fontFamily", field.labelFontFamily ? literal(field.labelFontFamily) : undefined],
    ["color", toThemeColorLiteral({ color: field.labelColor, tokens: context.tokens })]
  ]);
  const outlineStyle = sxString([["borderColor", toThemeColorLiteral({ color: outlineStrokeColor, tokens: context.tokens })]]);
  const endAdornment =
    !field.isSelect && field.suffixText
      ? `endAdornment: <InputAdornment position="end">{${literal(field.suffixText)}}</InputAdornment>`
      : "";
  const fieldErrorExpression = `(Boolean((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? ""))`;
  const fieldHelperTextExpression = `((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? "")`;
  const helperTextId = `${field.key}-helper-text`;
  const requiredProp = field.required ? `${indent}    required\n` : "";
  const ariaRequiredProp = field.required ? `${indent}    aria-required="true"\n` : "";

  if (field.isSelect) {
    registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem", "FormHelperText");
    const selectLabelId = `${field.key}-label`;
    return `${indent}<FormControl
${requiredProp}${indent}    error={${fieldErrorExpression}}
${indent}    sx={{ ${fieldSx} }}
${indent}  >
${indent}  <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(selectLabelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
${indent}    onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}    aria-describedby={${literal(helperTextId)}}
${ariaRequiredProp}${indent}    aria-label={${literal(field.label)}}
${indent}    sx={{
${indent}      ${inputRootStyle},
${indent}      "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }
${indent}    }}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
${indent}  <FormHelperText id={${literal(helperTextId)}}>{${fieldHelperTextExpression}}</FormHelperText>
${indent}</FormControl>`;
  }

  registerMuiImports(context, "TextField");
  if (field.suffixText) {
    registerMuiImports(context, "InputAdornment");
  }
  const placeholderProp = field.placeholder ? `${indent}  placeholder={${literal(field.placeholder)}}\n` : "";
  const typeProp = field.inputType ? `${indent}  type={${literal(field.inputType)}}\n` : "";
  const autoCompleteProp = field.autoComplete ? `${indent}  autoComplete={${literal(field.autoComplete)}}\n` : "";
  const textFieldRequiredProp = field.required ? `${indent}  required\n` : "";
  const slotPropsEntries = [
    endAdornment ? `input: { ${endAdornment} }` : "",
    `htmlInput: { "aria-describedby": ${literal(helperTextId)}${field.required ? ', "aria-required": "true"' : ""} }`,
    `formHelperText: { id: ${literal(helperTextId)} }`
  ]
    .filter((entry) => entry.length > 0)
    .join(`,\n${indent}    `);
  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${placeholderProp}${typeProp}${autoCompleteProp}${textFieldRequiredProp}${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}  error={${fieldErrorExpression}}
${indent}  helperText={${fieldHelperTextExpression}}
${indent}  aria-label={${literal(field.label)}}
${indent}  aria-describedby={${literal(helperTextId)}}
${indent}  sx={{
${indent}    ${fieldSx},
${indent}    "& .MuiOutlinedInput-root": { ${inputRootStyle} },
${indent}    "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} },
${indent}    "& .MuiInputLabel-root": { ${inputLabelStyle} }
${indent}  }}
${indent}  slotProps={{
${indent}    ${slotPropsEntries}
${indent}  }}
${indent}/>`;
};

const renderSemanticAccordion = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const accordionModel = registerInteractiveAccordion({
    context,
    element,
    defaultExpanded: true
  });
  const summaryRoot = findFirstByName(element, "muibuttonbaseroot") ?? element.children?.[0] ?? element;
  const summaryContent = findFirstByName(summaryRoot, "accordionsummarycontent") ?? summaryRoot;
  const detailsRoot = findFirstByName(element, "collapsewrapper") ?? element.children?.[1] ?? element;
  const detailsContainer = detailsRoot.children?.length === 1 ? (detailsRoot.children[0] ?? detailsRoot) : detailsRoot;

  const summaryChildren = sortChildren(summaryContent.children ?? [], summaryContent.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const renderedSummary = summaryChildren
    .map((child) =>
      renderElement(
        child,
        depth + 3,
        {
          x: summaryContent.x,
          y: summaryContent.y,
          width: summaryContent.width,
          height: summaryContent.height,
          name: summaryContent.name,
          layoutMode: summaryContent.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const detailChildren = sortChildren(detailsContainer.children ?? [], detailsContainer.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const renderedDetails = detailChildren
    .map((child) =>
      renderElement(
        child,
        depth + 2,
        {
          x: detailsContainer.x,
          y: detailsContainer.y,
          width: detailsContainer.width,
          height: detailsContainer.height,
          name: detailsContainer.name,
          layoutMode: detailsContainer.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const summaryFallbackLabel = firstText(summaryContent) ?? firstText(element) ?? "Accordion";
  const expandIconNode = findFirstByName(summaryRoot, "expandiconwrapper") ?? findFirstByName(element, "expandiconwrapper");
  const expandIconPaths = expandIconNode ? collectVectorPaths(expandIconNode) : [];

  let expandIconExpression: string;
  if (expandIconPaths.length > 0) {
    expandIconExpression = renderInlineSvgIcon({
      icon: {
        paths: expandIconPaths,
        color: expandIconNode ? firstVectorColor(expandIconNode) : undefined,
        width: expandIconNode?.width,
        height: expandIconNode?.height
      },
      context,
      extraEntries: [["fontSize", literal("inherit")]]
    });
  } else {
    const expandMoreIcon = registerIconImport(context, {
      localName: "ExpandMoreIcon",
      modulePath: "@mui/icons-material/ExpandMore"
    });
    expandIconExpression = `<${expandMoreIcon} fontSize="small" />`;
  }
  registerMuiImports(context, "Accordion", "AccordionSummary", "AccordionDetails", "Box", "Typography");

  const detailsWidthRatio =
    typeof detailsContainer.width === "number" &&
    Number.isFinite(detailsContainer.width) &&
    detailsContainer.width > 0 &&
    typeof element.width === "number" &&
    Number.isFinite(element.width) &&
    element.width > 0
      ? detailsContainer.width / element.width
      : undefined;
  const detailsResponsiveWidth = toPercentLiteralFromRatio(detailsWidthRatio) ?? literal("100%");

  const detailsSx = sxString([
    ["position", literal("relative")],
    ["width", detailsResponsiveWidth],
    ["maxWidth", toPxLiteral(detailsContainer.width)],
    ["minHeight", toPxLiteral(detailsContainer.height)],
    ["display", detailsContainer.layoutMode === "NONE" ? literal("block") : literal("flex")],
    ["flexDirection", detailsContainer.layoutMode === "HORIZONTAL" ? literal("row") : literal("column")],
    [
      "gap",
      detailsContainer.gap && detailsContainer.gap > 0
        ? toSpacingUnitValue({ value: detailsContainer.gap, spacingBase: context.spacingBase })
        : undefined
    ],
    ...toBoxSpacingSxEntries({
      values: detailsContainer.padding,
      spacingBase: context.spacingBase,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    })
  ]);

  const summarySx = sxString([
    ["minHeight", toPxLiteral(summaryRoot.height)],
    ...toBoxSpacingSxEntries({
      values: summaryRoot.padding,
      spacingBase: context.spacingBase,
      allKey: "p",
      xKey: "px",
      yKey: "py",
      topKey: "pt",
      rightKey: "pr",
      bottomKey: "pb",
      leftKey: "pl"
    })
  ]);

  const accordionSx = sxString([
    ...baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase
    }),
    ["boxShadow", literal("none")]
  ]);

  return `${indent}<Accordion
${indent}  expanded={accordionState[${literal(accordionModel.key)}] ?? ${accordionModel.defaultExpanded ? "true" : "false"}}
${indent}  onChange={(_, expanded) => updateAccordionState(${literal(accordionModel.key)}, expanded)}
${indent}  disableGutters
${indent}  elevation={0}
${indent}  square
${indent}  sx={{ ${accordionSx}, "&::before": { display: "none" } }}
${indent}>
${indent}  <AccordionSummary expandIcon={${expandIconExpression}} sx={{ ${summarySx} }}>
${indent}    <Box sx={{ width: "100%", position: "relative", minHeight: ${literal(`${Math.max(20, Math.round(summaryContent.height ?? 24))}px`)} }}>
${renderedSummary || `${indent}      <Typography>{${literal(summaryFallbackLabel)}}</Typography>`}
${indent}    </Box>
${indent}  </AccordionSummary>
${indent}  <AccordionDetails sx={{ p: 0 }}>
${indent}    <Box sx={{ ${detailsSx} }}>
${renderedDetails || `${indent}      <Box />`}
${indent}    </Box>
${indent}  </AccordionDetails>
${indent}</Accordion>`;
};

interface ResolvedPrototypeNavigation {
  routePath: string;
  replace: boolean;
}

const resolvePrototypeNavigationBinding = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): ResolvedPrototypeNavigation | undefined => {
  const targetScreenId = element.prototypeNavigation?.targetScreenId;
  if (!targetScreenId) {
    return undefined;
  }
  const routePath = context.routePathByScreenId.get(targetScreenId);
  if (!routePath) {
    return undefined;
  }
  return {
    routePath,
    replace: element.prototypeNavigation?.mode === "replace"
  };
};

const toRouterLinkProps = ({
  navigation,
  context
}: {
  navigation: ResolvedPrototypeNavigation;
  context: RenderContext;
}): string => {
  context.usesRouterLink = true;
  context.prototypeNavigationRenderedCount += 1;
  const replaceProp = navigation.replace ? " replace" : "";
  return ` component={RouterLink} to={${literal(navigation.routePath)}}${replaceProp}`;
};

const toNavigateHandlerProps = ({
  navigation,
  context
}: {
  navigation: ResolvedPrototypeNavigation;
  context: RenderContext;
}): {
  onClickProp: string;
  onKeyDownProp: string;
  roleProp: string;
  tabIndexProp: string;
} => {
  context.usesNavigateHandler = true;
  context.prototypeNavigationRenderedCount += 1;
  const navigateCall = navigation.replace
    ? `navigate(${literal(navigation.routePath)}, { replace: true })`
    : `navigate(${literal(navigation.routePath)})`;
  return {
    onClickProp: ` onClick={() => ${navigateCall}}`,
    onKeyDownProp:
      ' onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ' +
      `${navigateCall}; } }}`,
    roleProp: ' role="button"',
    tabIndexProp: " tabIndex={0}"
  };
};

const renderButton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Button");
  const indent = "  ".repeat(depth);
  const buttonKey = toStateKey(element);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const textNodes = collectTextNodes(element)
    .filter((node) => Boolean(node.text?.trim()))
    .sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0));
  const labelNode = textNodes[0];
  const label = labelNode?.text?.trim();
  const buttonTextColor = firstTextColor(element);
  const endIconRoot = findFirstByName(element, "buttonendicon");
  const iconNode = pickBestIconNode(element) ?? endIconRoot;
  const isIconOnlyButton = !label && Boolean(iconNode);
  const inferredDisabled = inferButtonDisabled({
    element,
    mappedDisabled: mappedMuiProps?.disabled,
    buttonTextColor
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });

  if (iconNode && isIconOnlyButton) {
    registerMuiImports(context, "IconButton");
    const iconColor = resolveIconColor(iconNode) ?? buttonTextColor;
    const iconButtonSx = sxString([
      ...baseLayoutEntries(element, parent, {
        spacingBase: context.spacingBase,
        tokens: context.tokens
      }),
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase
      }),
      ["color", toThemeColorLiteral({ color: iconColor, tokens: context.tokens })]
    ]);
    const iconButtonSxWithState = appendVariantStateOverridesToSx({
      sx: iconButtonSx,
      element,
      tokens: context.tokens
    });
    const iconExpression = renderFallbackIconExpression({
      element: iconNode,
      parent: { name: endIconRoot?.name ?? element.name },
      context,
      ariaHidden: true,
      extraEntries: [["fontSize", literal("inherit")]]
    });
    const disabledProp = inferredDisabled ? " disabled" : "";
    const ariaLabel = resolveIconButtonAriaLabel({ element, iconNode });
    const linkProps = navigation && !inferredDisabled ? toRouterLinkProps({ navigation, context }) : "";
    return `${indent}<IconButton aria-label=${literal(ariaLabel)}${linkProps}${disabledProp} sx={{ ${iconButtonSxWithState} }}>${iconExpression}</IconButton>`;
  }

  const iconExpression = iconNode
    ? renderFallbackIconExpression({
        element: iconNode,
        parent: { name: endIconRoot?.name ?? element.name },
        context,
        ariaHidden: true,
        extraEntries: [["fontSize", literal("inherit")]]
      })
    : undefined;
  const iconBelongsAtEnd =
    Boolean(iconNode && endIconRoot) ||
    Boolean(
      iconNode &&
        labelNode &&
        typeof iconNode.x === "number" &&
        typeof labelNode.x === "number" &&
        iconNode.x > labelNode.x
    );

  const variant = inferButtonVariant({
    element,
    mappedVariant: mappedMuiProps?.variant
  });
  context.buttons.push({
    key: buttonKey,
    preferredSubmit: variant === "contained",
    eligibleForSubmit: !inferredDisabled
  });
  const size = inferButtonSize({
    element,
    mappedSize: mappedMuiProps?.size
  });
  const fullWidth = inferButtonFullWidth({
    element,
    parent
  });

  const sxEntries = filterButtonVariantEntries({
    entries: [
    ...baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase
    }),
    ["fontSize", element.fontSize ? toRemLiteral(element.fontSize) : undefined],
    ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
    ["color", toThemeColorLiteral({ color: buttonTextColor, tokens: context.tokens })],
    ["textTransform", literal("none")],
    ["justifyContent", literal("center")]
    ],
    variant,
    element,
    fullWidth,
    tokens: context.tokens
  });
  const sx = sxString(sxEntries);

  const sxWithVariantStates = appendVariantStateOverridesToSx({
    sx,
    element,
    tokens: context.tokens
  });
  const sizeProp = size ? ` size="${size}"` : "";
  const fullWidthProp = fullWidth ? " fullWidth" : "";
  const disabledProp = inferredDisabled ? " disabled" : "";
  const startIconProp = iconExpression && !iconBelongsAtEnd ? ` startIcon={${iconExpression}}` : "";
  const endIconProp = iconExpression && iconBelongsAtEnd ? ` endIcon={${iconExpression}}` : "";
  const typeProp = navigation ? "" : ` type={primarySubmitButtonKey === ${literal(buttonKey)} ? "submit" : "button"}`;
  const linkProps = navigation && !inferredDisabled ? toRouterLinkProps({ navigation, context }) : "";

  return `${indent}<Button variant="${variant}"${linkProps}${sizeProp}${fullWidthProp}${disabledProp} disableElevation${typeProp}${startIconProp}${endIconProp} sx={{ ${sxWithVariantStates} }}>{${literal(label ?? element.name)}}</Button>`;
};

const isPillShapedOutlinedButton = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  const hasStroke = Boolean(element.strokeColor);
  const isPill = (element.cornerRadius ?? 0) >= 32;
  const texts = collectTextNodes(element);
  const hasSingleText = texts.length >= 1 && Boolean(texts[0]?.text?.trim());
  const noFill =
    (!element.fillColor || element.fillColor === "#ffffff" || element.fillColor === "#FFFFFF") && !element.fillGradient;
  return hasStroke && isPill && hasSingleText && noFill;
};

const renderChildrenIntoParent = ({
  element,
  depth,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
}): string => {
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  return children
    .map((child) =>
      renderElement(
        child,
        depth,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
};

const renderNodesIntoParent = ({
  nodes,
  parent,
  depth,
  context,
  layoutMode = "NONE"
}: {
  nodes: ScreenElementIR[];
  parent: ScreenElementIR;
  depth: number;
  context: RenderContext;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
}): string => {
  const sortedNodes = sortChildren(nodes, layoutMode, {
    generationLocale: context.generationLocale
  });
  return sortedNodes
    .map((node) =>
      renderElement(
        node,
        depth,
        {
          x: parent.x,
          y: parent.y,
          width: parent.width,
          height: parent.height,
          name: parent.name,
          fillColor: parent.fillColor,
          fillGradient: parent.fillGradient,
          layoutMode: parent.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
};

const SIMPLE_STACK_GEOMETRY_SX_KEYS = new Set([
  "position",
  "left",
  "top",
  "width",
  "maxWidth",
  "height",
  "minHeight"
]);

const hasResponsiveTopLevelLayoutOverrides = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  return Boolean(context.responsiveTopLevelLayoutOverrides?.[element.id]);
};

const hasVisibleBorderSignal = (element: ScreenElementIR): boolean => {
  if (!element.strokeColor) {
    return false;
  }
  if (element.strokeWidth === undefined) {
    return true;
  }
  return Number.isFinite(element.strokeWidth) && element.strokeWidth > 0;
};

const hasDistinctSurfaceFill = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  const normalizedFill = normalizeHexColor(element.fillColor);
  const normalizedPageBackground = context.pageBackgroundColorNormalized;
  if (!normalizedFill || !normalizedPageBackground) {
    return false;
  }
  return normalizedFill !== normalizedPageBackground;
};

const isElevatedSurfaceContainerForPaper = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type !== "container") {
    return false;
  }
  if ((element.children?.length ?? 0) === 0) {
    return false;
  }
  if (!hasMeaningfulTextDescendants({ element, context })) {
    return false;
  }
  if (hasResponsiveTopLevelLayoutOverrides({ element, context })) {
    return false;
  }

  const hasRoundedSurface = typeof element.cornerRadius === "number" && Number.isFinite(element.cornerRadius) && element.cornerRadius > 0;
  if (!hasRoundedSurface) {
    return false;
  }

  const normalizedElevation = normalizeElevationForSx(element.elevation);
  const hasElevation = typeof normalizedElevation === "number" && normalizedElevation > 0;
  const hasInsetShadow = typeof element.insetShadow === "string" && element.insetShadow.trim().length > 0;
  const hasInsetShadowOnly = hasInsetShadow && !hasElevation;

  const elevatedSurfaceMatch = hasDistinctSurfaceFill({ element, context }) && hasElevation && !hasInsetShadowOnly;
  const outlinedSurfaceMatch = hasVisibleBorderSignal(element) && !hasElevation && !hasInsetShadow;
  return elevatedSurfaceMatch || outlinedSurfaceMatch;
};

const isSimpleFlexContainerForStack = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (element.type !== "container") {
    return false;
  }
  const layoutMode = element.layoutMode ?? "NONE";
  if (layoutMode !== "VERTICAL" && layoutMode !== "HORIZONTAL") {
    return false;
  }
  if ((element.children?.length ?? 0) === 0) {
    return false;
  }
  if (hasResponsiveTopLevelLayoutOverrides({ element, context })) {
    return false;
  }

  const hasVisualStylingSignals = Boolean(
    hasVisualStyle(element) ||
      (typeof element.strokeWidth === "number" && Number.isFinite(element.strokeWidth) && element.strokeWidth > 0) ||
      (typeof element.opacity === "number" && Number.isFinite(element.opacity) && element.opacity !== 1)
  );
  return !hasVisualStylingSignals;
};

const toSimpleStackContainerSx = ({
  element,
  parent,
  context
}: {
  element: ScreenElementIR;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  const baseEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  }).filter(([key]) => SIMPLE_STACK_GEOMETRY_SX_KEYS.has(key));
  return sxString(baseEntries);
};

const renderSimpleFlexContainerAsStack = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  registerMuiImports(context, "Stack");
  const indent = "  ".repeat(depth);
  const layoutMode = element.layoutMode === "HORIZONTAL" ? "HORIZONTAL" : "VERTICAL";
  const direction = layoutMode === "HORIZONTAL" ? "row" : "column";
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 0
      : 0;
  const alignItems = mapCounterAxisAlignToAlignItems(element.counterAxisAlignItems, layoutMode);
  const justifyContent = mapPrimaryAxisAlignToJustifyContent(element.primaryAxisAlignItems);
  const sx = toSimpleStackContainerSx({
    element,
    parent,
    context
  });
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = landmarkRole ? `role="${landmarkRole}"` : undefined;
  const ariaHiddenProp = isDecorative ? 'aria-hidden="true"' : undefined;
  const props = [
    `direction=${literal(direction)}`,
    `spacing={${spacing}}`,
    alignItems ? `alignItems=${literal(alignItems)}` : undefined,
    justifyContent ? `justifyContent=${literal(justifyContent)}` : undefined,
    roleProp,
    ariaHiddenProp,
    sx ? `sx={{ ${sx} }}` : undefined
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack ${props} />`;
  }
  return `${indent}<Stack ${props}>
${renderedChildren}
${indent}</Stack>`;
};

interface RenderedItem {
  id: string;
  label: string;
  node: ScreenElementIR;
}

interface DetectedTabInterfacePattern {
  tabStripNode: ScreenElementIR;
  tabItems: RenderedItem[];
  panelNodes: ScreenElementIR[];
}

interface DialogActionModel {
  id: string;
  label: string;
  isPrimary: boolean;
}

interface DetectedDialogOverlayPattern {
  panelNode: ScreenElementIR;
  title: string | undefined;
  contentNodes: ScreenElementIR[];
  actionModels: DialogActionModel[];
}

const NAVIGATION_BAR_CANDIDATE_TYPES = new Set<ScreenElementIR["type"]>(["container", "stack", "table"]);
const NAVIGATION_BAR_TOP_LEVEL_DEPTH = 3;
const NAVIGATION_BAR_MIN_HEIGHT_PX = 40;
const NAVIGATION_BAR_MAX_HEIGHT_PX = 180;
const NAVIGATION_BAR_MIN_WIDTH_RATIO = 0.9;
const NAVIGATION_BAR_EDGE_PROXIMITY_PX = 56;
const NAVIGATION_BAR_MIN_RENDERABLE_BOTTOM_ACTIONS = 2;
const NAVIGATION_BAR_DATA_TABLE_MIN_ROWS = 2;
const NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS = 2;
const NAVIGATION_BAR_DATA_TABLE_TEXT_CELL_RATIO_MIN = 0.75;
const TAB_PATTERN_MIN_ACTIONS = 2;
const TAB_PATTERN_MAX_ACTIONS = 8;
const TAB_PATTERN_ROW_CENTER_TOLERANCE_PX = 16;
const TAB_PATTERN_GAP_TOLERANCE_RATIO = 0.65;
const TAB_PATTERN_GAP_TOLERANCE_PX = 24;
const TAB_PATTERN_PANEL_MIN_CONTENT_HEIGHT_PX = 24;
const TAB_PATTERN_STRIP_NAME_HINTS = ["tab", "tabs", "tab bar", "tabbar"];
const DIALOG_PATTERN_MIN_WIDTH_RATIO = 0.85;
const DIALOG_PATTERN_MIN_HEIGHT_RATIO = 0.55;
const DIALOG_PATTERN_PANEL_MIN_WIDTH_RATIO = 0.3;
const DIALOG_PATTERN_PANEL_MAX_WIDTH_RATIO = 0.95;
const DIALOG_PATTERN_PANEL_MIN_HEIGHT_RATIO = 0.2;
const DIALOG_PATTERN_PANEL_MAX_HEIGHT_RATIO = 0.95;
const DIALOG_PATTERN_CENTER_TOLERANCE_RATIO = 0.2;
const DIALOG_PATTERN_CENTER_TOLERANCE_PX = 80;
const DIALOG_ACTION_HINTS = ["ok", "confirm", "save", "cancel", "discard", "apply", "close", "bestätigen", "speichern", "abbrechen"];
const DIALOG_CLOSE_HINTS = ["close", "dismiss", "cancel", "x", "schließen", "abbrechen"];

interface ListRowAnalysis {
  node: ScreenElementIR;
  primaryText: string;
  secondaryText?: string;
  leadingAvatarNode?: ScreenElementIR;
  leadingIconNode?: ScreenElementIR;
  trailingActionNode?: ScreenElementIR;
  hasLeadingVisual: boolean;
  hasTrailingAction: boolean;
  structureSignature: string;
}

interface ListRowCollection {
  rowNodes: ScreenElementIR[];
  hasInterItemDivider: boolean;
}

interface DetectedListPattern {
  rows: ListRowAnalysis[];
  hasInterItemDivider: boolean;
}

const LIST_PATTERN_MIN_ROWS = 3;
const LIST_PATTERN_VERTICAL_DELTA_MIN_PX = 8;
const LIST_PATTERN_VERTICAL_DELTA_RATIO_TOLERANCE = 0.35;
const LIST_PATTERN_VERTICAL_DELTA_ABSOLUTE_TOLERANCE_PX = 12;
const LIST_ACTION_RIGHT_REGION_RATIO = 0.62;
const LIST_ACTION_NAME_HINTS = [
  "action",
  "more",
  "menu",
  "next",
  "arrow",
  "edit",
  "delete",
  "remove",
  "open",
  "close",
  "chevron"
];

const isDividerLikeListSeparator = (element: ScreenElementIR): boolean => {
  if (element.type === "divider") {
    return true;
  }
  if ((element.children?.length ?? 0) > 0) {
    return false;
  }
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const hasVisualSignal = Boolean(element.fillColor || element.strokeColor);
  if (!hasVisualSignal) {
    return false;
  }
  const horizontalLine = width >= 16 && height > 0 && height <= 2;
  const verticalLine = height >= 16 && width > 0 && width <= 2;
  return horizontalLine || verticalLine;
};

const isAvatarLikeListNode = (element: ScreenElementIR): boolean => {
  if (element.type === "avatar") {
    return true;
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  return normalizedName.includes("avatar");
};

const isListActionLikeNode = (element: ScreenElementIR): boolean => {
  if (element.prototypeNavigation) {
    return true;
  }
  if (element.type === "button" || element.type === "switch" || element.type === "checkbox" || element.type === "radio") {
    return true;
  }
  if (isIconLikeNode(element) || isSemanticIconWrapper(element)) {
    return true;
  }
  if (pickBestIconNode(element)) {
    return true;
  }
  const normalizedName = normalizeInputSemanticText(element.name);
  return LIST_ACTION_NAME_HINTS.some((hint) => normalizedName.includes(hint));
};

const toListNodeStartX = (node: ScreenElementIR): number | undefined => {
  if (typeof node.x !== "number" || !Number.isFinite(node.x)) {
    return undefined;
  }
  return node.x;
};

const toListNodeEndX = (node: ScreenElementIR): number | undefined => {
  if (typeof node.x !== "number" || !Number.isFinite(node.x)) {
    return undefined;
  }
  if (typeof node.width === "number" && Number.isFinite(node.width) && node.width > 0) {
    return node.x + node.width;
  }
  return node.x;
};

const toListRowHorizontalBounds = ({
  children
}: {
  children: ScreenElementIR[];
}): { minX: number; maxX: number } | undefined => {
  const startValues = children.map(toListNodeStartX).filter((value): value is number => typeof value === "number");
  const endValues = children.map(toListNodeEndX).filter((value): value is number => typeof value === "number");
  if (startValues.length === 0 || endValues.length === 0) {
    return undefined;
  }
  const minX = Math.min(...startValues);
  const maxX = Math.max(...endValues);
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
    return undefined;
  }
  return { minX, maxX };
};

const isRightAlignedListActionCandidate = ({
  node,
  bounds
}: {
  node: ScreenElementIR;
  bounds: { minX: number; maxX: number } | undefined;
}): boolean => {
  if (!bounds) {
    return false;
  }
  const nodeStartX = toListNodeStartX(node);
  if (typeof nodeStartX !== "number") {
    return false;
  }
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const threshold = bounds.minX + width * LIST_ACTION_RIGHT_REGION_RATIO;
  return nodeStartX >= threshold;
};

const collectSubtreeNodeIds = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element.id, ...(element.children ?? []).flatMap((child) => collectSubtreeNodeIds(child, visited))];
};

const analyzeListRow = ({
  row,
  generationLocale
}: {
  row: ScreenElementIR;
  generationLocale: string | undefined;
}): ListRowAnalysis => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  const sortedChildren = sortChildren(row.children ?? [], row.layoutMode ?? "NONE", sortOptions).filter(
    (child) => !isDividerLikeListSeparator(child)
  );
  const bounds = toListRowHorizontalBounds({ children: sortedChildren });

  let trailingActionNode: ScreenElementIR | undefined;
  for (const child of [...sortedChildren].reverse()) {
    if (!isListActionLikeNode(child)) {
      continue;
    }
    if (!isRightAlignedListActionCandidate({ node: child, bounds })) {
      continue;
    }
    trailingActionNode = child;
    break;
  }

  const leadingAvatarNode = sortedChildren.find((child) => child.id !== trailingActionNode?.id && isAvatarLikeListNode(child));
  const leadingIconNode = leadingAvatarNode
    ? undefined
    : sortedChildren.find((child) => {
        if (child.id === trailingActionNode?.id) {
          return false;
        }
        if (isIconLikeNode(child) || isSemanticIconWrapper(child)) {
          return true;
        }
        if (child.type === "container") {
          return Boolean(pickBestIconNode(child));
        }
        return false;
      });

  const excludedTextNodeIds = new Set<string>();
  if (trailingActionNode) {
    for (const nodeId of collectSubtreeNodeIds(trailingActionNode)) {
      excludedTextNodeIds.add(nodeId);
    }
  }
  if (leadingAvatarNode) {
    for (const nodeId of collectSubtreeNodeIds(leadingAvatarNode)) {
      excludedTextNodeIds.add(nodeId);
    }
  }

  const textNodes = collectTextNodes(row)
    .filter((node) => !excludedTextNodeIds.has(node.id))
    .sort((left, right) => (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0));
  const textValues = textNodes.map((node) => node.text?.trim() ?? "").filter((value) => value.length > 0);
  const fallbackLabel = firstText(row)?.trim() || row.name || "Item";
  const primaryText = textValues[0] ?? fallbackLabel;
  const secondaryText = textValues[1] && textValues[1] !== primaryText ? textValues[1] : undefined;
  const hasLeadingVisual = Boolean(leadingAvatarNode || leadingIconNode);
  const hasTrailingAction = Boolean(trailingActionNode);
  const leadingSignature = leadingAvatarNode ? "avatar" : leadingIconNode ? "icon" : "none";
  const textSignature = textValues.length >= 2 ? "text2" : textValues.length === 1 ? "text1" : "text0";
  const actionSignature = hasTrailingAction ? "action" : "none";

  return {
    node: row,
    primaryText,
    ...(secondaryText ? { secondaryText } : {}),
    ...(leadingAvatarNode ? { leadingAvatarNode } : {}),
    ...(leadingIconNode ? { leadingIconNode } : {}),
    ...(trailingActionNode ? { trailingActionNode } : {}),
    hasLeadingVisual,
    hasTrailingAction,
    structureSignature: `${leadingSignature}|${textSignature}|${actionSignature}`
  };
};

const collectListRows = (element: ScreenElementIR, generationLocale?: string): ListRowCollection => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", sortOptions);
  const rowNodes: ScreenElementIR[] = [];
  let hasInterItemDivider = false;
  let seenRow = false;
  for (const child of sortedChildren) {
    if (isDividerLikeListSeparator(child)) {
      if (seenRow) {
        hasInterItemDivider = true;
      }
      continue;
    }
    rowNodes.push(child);
    seenRow = true;
  }
  return {
    rowNodes,
    hasInterItemDivider
  };
};

const detectRepeatedListPattern = ({
  element,
  generationLocale
}: {
  element: ScreenElementIR;
  generationLocale: string;
}): DetectedListPattern | undefined => {
  if (element.type !== "container") {
    return undefined;
  }
  const collectedRows = collectListRows(element, generationLocale);
  if (collectedRows.rowNodes.length < LIST_PATTERN_MIN_ROWS) {
    return undefined;
  }

  const rowAnalyses = collectedRows.rowNodes.map((row) => analyzeListRow({ row, generationLocale }));
  const baselineSignature = rowAnalyses[0]?.structureSignature;
  if (!baselineSignature || rowAnalyses.some((analysis) => analysis.structureSignature !== baselineSignature)) {
    return undefined;
  }
  if (!rowAnalyses[0]?.hasLeadingVisual && !rowAnalyses[0]?.hasTrailingAction) {
    return undefined;
  }
  if (rowAnalyses.some((analysis) => analysis.primaryText.trim().length === 0)) {
    return undefined;
  }

  const rowYValues = collectedRows.rowNodes
    .map((row) => row.y)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (rowYValues.length !== collectedRows.rowNodes.length) {
    return undefined;
  }
  const yDeltas = rowYValues.slice(1).map((value, index) => value - rowYValues[index]!);
  if (yDeltas.some((delta) => delta < LIST_PATTERN_VERTICAL_DELTA_MIN_PX)) {
    return undefined;
  }
  const averageDelta = yDeltas.reduce((total, delta) => total + delta, 0) / yDeltas.length;
  const tolerance = Math.max(
    LIST_PATTERN_VERTICAL_DELTA_ABSOLUTE_TOLERANCE_PX,
    averageDelta * LIST_PATTERN_VERTICAL_DELTA_RATIO_TOLERANCE
  );
  if (yDeltas.some((delta) => Math.abs(delta - averageDelta) > tolerance)) {
    return undefined;
  }

  return {
    rows: rowAnalyses,
    hasInterItemDivider: collectedRows.hasInterItemDivider
  };
};

const toListSecondaryActionExpression = ({
  actionNode,
  context
}: {
  actionNode: ScreenElementIR | undefined;
  context: RenderContext;
}): string | undefined => {
  if (!actionNode) {
    return undefined;
  }
  const actionIconNode = pickBestIconNode(actionNode) ?? (isIconLikeNode(actionNode) ? actionNode : undefined);
  if (!actionIconNode) {
    return undefined;
  }
  registerMuiImports(context, "IconButton");
  const ariaLabel = resolveIconButtonAriaLabel({ element: actionNode, iconNode: actionIconNode });
  const navigation = resolvePrototypeNavigationBinding({ element: actionNode, context });
  const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
  const iconExpression = renderFallbackIconExpression({
    element: actionIconNode,
    parent: { name: actionNode.name },
    context,
    ariaHidden: true,
    extraEntries: [["fontSize", literal("inherit")]]
  });
  return `<IconButton edge="end" aria-label=${literal(ariaLabel)}${linkProps}>${iconExpression}</IconButton>`;
};

const renderListFromRows = ({
  element,
  rows,
  hasInterItemDivider,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  rows: ListRowAnalysis[];
  hasInterItemDivider: boolean;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): string => {
  registerMuiImports(context, "List", "ListItem", "ListItemText");
  if (rows.some((row) => Boolean(row.leadingIconNode))) {
    registerMuiImports(context, "ListItemIcon");
  }
  if (rows.some((row) => Boolean(row.leadingAvatarNode))) {
    registerMuiImports(context, "ListItemAvatar", "Avatar");
  }
  if (hasInterItemDivider) {
    registerMuiImports(context, "Divider");
  }

  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedItems = rows
    .map((row, index) => {
      const listNavigation = resolvePrototypeNavigationBinding({ element: row.node, context });
      const secondaryActionExpression = toListSecondaryActionExpression({
        actionNode: row.trailingActionNode,
        context
      });
      const secondaryActionProp = secondaryActionExpression ? ` secondaryAction={${secondaryActionExpression}}` : "";
      const avatarBlock = row.leadingAvatarNode
        ? `<ListItemAvatar><Avatar>${(() => {
            const avatarText = firstText(row.leadingAvatarNode)?.trim();
            return avatarText ? `{${literal(avatarText)}}` : "";
          })()}</Avatar></ListItemAvatar>`
        : "";
      const iconBlock = row.leadingIconNode
        ? `<ListItemIcon>${renderFallbackIconExpression({
            element: row.leadingIconNode,
            parent: { name: row.node.name },
            context,
            ariaHidden: true
          })}</ListItemIcon>`
        : "";
      const textProps = row.secondaryText
        ? ` primary={${literal(row.primaryText)}} secondary={${literal(row.secondaryText)}}`
        : ` primary={${literal(row.primaryText)}}`;
      const textBlock = `<ListItemText${textProps} />`;
      const content = `${avatarBlock}${iconBlock}${textBlock}`;
      if (listNavigation) {
        registerMuiImports(context, "ListItemButton");
      }
      const linkProps = listNavigation ? toRouterLinkProps({ navigation: listNavigation, context }) : "";
      const itemBody = listNavigation ? `<ListItemButton${linkProps}>${content}</ListItemButton>` : content;
      const dividerBlock = hasInterItemDivider && index < rows.length - 1 ? `\n${indent}  <Divider component="li" />` : "";
      return `${indent}  <ListItem key={${literal(row.node.id)}} disablePadding${secondaryActionProp}>${itemBody}</ListItem>${dividerBlock}`;
    })
    .join("\n");
  return `${indent}<List sx={{ ${sx} }}>
${renderedItems}
${indent}</List>`;
};

const collectRenderedItems = (element: ScreenElementIR, generationLocale?: string): RenderedItem[] => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  return sortChildren(element.children ?? [], element.layoutMode ?? "NONE", sortOptions)
    .map((child, index) => ({
      id: child.id || `${element.id}-item-${index + 1}`,
      label: firstText(child)?.trim() || child.name || `Item ${index + 1}`,
      node: child
    }))
    .filter((entry) => entry.label.trim().length > 0);
};

const collectRenderedItemLabels = (element: ScreenElementIR, generationLocale?: string): Array<{ id: string; label: string }> => {
  return collectRenderedItems(element, generationLocale).map((item) => ({
    id: item.id,
    label: item.label
  }));
};

const hasNavigationNameHintInSubtree = (element: ScreenElementIR): boolean => {
  const semanticCandidates = [element.name, element.text ?? "", ...collectSubtreeNames(element)];
  return semanticCandidates.some((candidate) => {
    const normalized = normalizeInputSemanticText(candidate);
    if (!normalized) {
      return false;
    }
    return A11Y_NAVIGATION_HINTS.some((hint) => normalized.includes(hint));
  });
};

const hasPrototypeNavigationInSubtree = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): boolean => {
  if (visited.has(element)) {
    return false;
  }
  visited.add(element);
  if (element.prototypeNavigation) {
    return true;
  }
  return (element.children ?? []).some((child) => hasPrototypeNavigationInSubtree(child, visited));
};

const toFiniteNumber = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const isLikelyStructuredDataTable = ({
  element,
  generationLocale
}: {
  element: ScreenElementIR;
  generationLocale: string;
}): boolean => {
  const rows = sortChildren(element.children ?? [], element.layoutMode ?? "VERTICAL", {
    generationLocale
  })
    .map((row) => {
      const rowChildren = sortChildren(row.children ?? [], row.layoutMode ?? "HORIZONTAL", {
        generationLocale
      });
      return rowChildren.length > 0 ? rowChildren : [row];
    })
    .filter((row) => row.length > 0);

  if (rows.length < NAVIGATION_BAR_DATA_TABLE_MIN_ROWS) {
    return false;
  }

  const columnCounts = rows.map((row) => row.length);
  const minColumns = Math.min(...columnCounts);
  const maxColumns = Math.max(...columnCounts);
  if (minColumns < NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS || maxColumns - minColumns > 1) {
    return false;
  }

  const flattenedCells = rows.flat();
  if (flattenedCells.length < NAVIGATION_BAR_DATA_TABLE_MIN_ROWS * NAVIGATION_BAR_DATA_TABLE_MIN_COLUMNS) {
    return false;
  }
  const textCellCount = flattenedCells.filter((cell) => Boolean(firstText(cell)?.trim() || cell.type === "text")).length;
  return textCellCount / flattenedCells.length >= NAVIGATION_BAR_DATA_TABLE_TEXT_CELL_RATIO_MIN;
};

const isRenderableBottomNavigationAction = ({
  action,
  context
}: {
  action: RenderedItem;
  context: RenderContext;
}): boolean => {
  if (action.label.trim().length === 0) {
    return false;
  }
  if (action.node.type === "button" || action.node.type === "navigation" || action.node.type === "tab") {
    return true;
  }
  if (action.node.prototypeNavigation) {
    return true;
  }
  if (isIconLikeNode(action.node) || isSemanticIconWrapper(action.node) || Boolean(pickBestIconNode(action.node))) {
    return true;
  }
  if (hasInteractiveDescendants({ element: action.node, context })) {
    return true;
  }
  return hasMeaningfulTextDescendants({ element: action.node, context });
};

const isRenderableTabAction = ({
  action,
  context
}: {
  action: RenderedItem;
  context: RenderContext;
}): boolean => {
  if (action.label.trim().length === 0) {
    return false;
  }
  if (action.node.type === "text" || action.node.type === "tab" || action.node.type === "button") {
    return true;
  }
  if (action.node.prototypeNavigation) {
    return true;
  }
  return hasMeaningfulTextDescendants({ element: action.node, context });
};

const hasHorizontalRowAlignment = ({
  nodes,
  layoutMode
}: {
  nodes: ScreenElementIR[];
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
}): boolean => {
  if (nodes.length < TAB_PATTERN_MIN_ACTIONS) {
    return false;
  }
  if (layoutMode === "HORIZONTAL") {
    return true;
  }
  const centerYValues = nodes
    .map((node) => {
      const y = toFiniteNumber(node.y);
      const height = toFiniteNumber(node.height);
      if (y === undefined) {
        return undefined;
      }
      return y + (height ?? 0) / 2;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (centerYValues.length !== nodes.length) {
    return false;
  }
  const minCenterY = Math.min(...centerYValues);
  const maxCenterY = Math.max(...centerYValues);
  return maxCenterY - minCenterY <= TAB_PATTERN_ROW_CENTER_TOLERANCE_PX;
};

const hasUniformHorizontalSpacing = (nodes: ScreenElementIR[]): boolean => {
  const sortedNodes = [...nodes].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  const centerXValues = sortedNodes
    .map((node) => {
      const x = toFiniteNumber(node.x);
      const width = toFiniteNumber(node.width);
      if (x === undefined) {
        return undefined;
      }
      return x + (width ?? 0) / 2;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (centerXValues.length !== sortedNodes.length) {
    return false;
  }
  const gaps = centerXValues.slice(1).map((centerX, index) => centerX - centerXValues[index]!);
  if (gaps.length === 0 || gaps.some((gap) => gap <= 0)) {
    return false;
  }
  if (gaps.length === 1) {
    return true;
  }
  const averageGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  const maxDelta = Math.max(...gaps.map((gap) => Math.abs(gap - averageGap)));
  return maxDelta <= Math.max(TAB_PATTERN_GAP_TOLERANCE_PX, averageGap * TAB_PATTERN_GAP_TOLERANCE_RATIO);
};

const hasTabNameHint = (element: ScreenElementIR): boolean => {
  const normalizedName = normalizeInputSemanticText(element.name);
  return TAB_PATTERN_STRIP_NAME_HINTS.some((hint) => normalizedName.includes(hint));
};

const hasUnderlineIndicatorInTabStrip = ({
  tabStripNode,
  tabActionNodeIds
}: {
  tabStripNode: ScreenElementIR;
  tabActionNodeIds: Set<string>;
}): boolean => {
  const stripY = toFiniteNumber(tabStripNode.y);
  const stripHeight = toFiniteNumber(tabStripNode.height);
  const stripWidth = toFiniteNumber(tabStripNode.width);
  const stripBottom = stripY !== undefined && stripHeight !== undefined ? stripY + stripHeight : undefined;
  return (tabStripNode.children ?? []).some((candidate) => {
    if (tabActionNodeIds.has(candidate.id)) {
      return false;
    }
    const normalizedName = normalizeInputSemanticText(candidate.name);
    if (normalizedName.includes("indicator") || normalizedName.includes("underline")) {
      return true;
    }
    if (isDividerLikeListSeparator(candidate)) {
      const candidateHeight = toFiniteNumber(candidate.height);
      const candidateWidth = toFiniteNumber(candidate.width);
      const candidateY = toFiniteNumber(candidate.y);
      if (
        stripBottom === undefined ||
        candidateHeight === undefined ||
        candidateWidth === undefined ||
        candidateY === undefined
      ) {
        return false;
      }
      if (stripWidth !== undefined && candidateWidth >= stripWidth * 0.9) {
        return false;
      }
      return Math.abs(stripBottom - (candidateY + candidateHeight)) <= 12;
    }
    const candidateHeight = toFiniteNumber(candidate.height);
    const candidateWidth = toFiniteNumber(candidate.width);
    const candidateY = toFiniteNumber(candidate.y);
    if (
      candidateHeight === undefined ||
      candidateWidth === undefined ||
      candidateY === undefined ||
      !candidate.fillColor ||
      candidateHeight > 4
    ) {
      return false;
    }
    if (stripWidth !== undefined && candidateWidth >= stripWidth * 0.9) {
      return false;
    }
    if (stripBottom === undefined) {
      return false;
    }
    return Math.abs(stripBottom - (candidateY + candidateHeight)) <= 12;
  });
};

const hasTabActiveVisualSignal = ({
  tabStripNode,
  tabItems
}: {
  tabStripNode: ScreenElementIR;
  tabItems: RenderedItem[];
}): boolean => {
  const colorSignals = new Set<string>();
  const fontWeights: number[] = [];
  for (const tabItem of tabItems) {
    const textNode = collectTextNodes(tabItem.node)[0];
    const color = normalizeHexColor(firstTextColor(tabItem.node) ?? tabItem.node.fillColor);
    if (color) {
      colorSignals.add(color);
    }
    const fontWeight = toFiniteNumber(textNode?.fontWeight ?? tabItem.node.fontWeight);
    if (fontWeight !== undefined) {
      fontWeights.push(fontWeight);
    }
  }
  const hasColorDelta = colorSignals.size >= 2;
  const hasWeightDelta = fontWeights.length >= 2 && Math.max(...fontWeights) - Math.min(...fontWeights) >= 120;
  const hasUnderlineSignal = hasUnderlineIndicatorInTabStrip({
    tabStripNode,
    tabActionNodeIds: new Set(tabItems.map((tabItem) => tabItem.node.id))
  });
  return hasColorDelta || hasWeightDelta || hasUnderlineSignal;
};

const toTabStripPatternCandidate = ({
  tabStripNode,
  context
}: {
  tabStripNode: ScreenElementIR;
  context: RenderContext;
}): { tabItems: RenderedItem[] } | undefined => {
  const tabItems = collectRenderedItems(tabStripNode, context.generationLocale).filter((action) =>
    isRenderableTabAction({
      action,
      context
    })
  );
  if (tabItems.length < TAB_PATTERN_MIN_ACTIONS || tabItems.length > TAB_PATTERN_MAX_ACTIONS) {
    return undefined;
  }
  const tabActionNodes = tabItems.map((tabItem) => tabItem.node);
  if (
    !hasHorizontalRowAlignment({
      nodes: tabActionNodes,
      layoutMode: tabStripNode.layoutMode ?? "NONE"
    })
  ) {
    return undefined;
  }
  if (!hasUniformHorizontalSpacing(tabActionNodes)) {
    return undefined;
  }
  const tabActionNodeIds = new Set(tabItems.map((tabItem) => tabItem.node.id));
  const hasUnderlineSignal = hasUnderlineIndicatorInTabStrip({
    tabStripNode,
    tabActionNodeIds
  });
  const hasTabHintSignal = hasTabNameHint(tabStripNode) || tabItems.some((tabItem) => hasTabNameHint(tabItem.node));
  const hasInteractiveTabSignal = tabItems.some((tabItem) => {
    if (tabItem.node.type === "button" || tabItem.node.prototypeNavigation) {
      return true;
    }
    return hasInteractiveDescendants({
      element: tabItem.node,
      context
    });
  });
  if (!hasTabHintSignal && !hasInteractiveTabSignal && !hasUnderlineSignal) {
    return undefined;
  }
  if (
    !hasTabActiveVisualSignal({
      tabStripNode,
      tabItems
    })
  ) {
    return undefined;
  }
  return { tabItems };
};

const resolveTabPanelNodes = ({
  hostElement,
  tabStripNode,
  tabCount,
  context
}: {
  hostElement: ScreenElementIR;
  tabStripNode: ScreenElementIR;
  tabCount: number;
  context: RenderContext;
}): ScreenElementIR[] => {
  if (hostElement.id === tabStripNode.id) {
    return [];
  }
  const siblings = sortChildren(hostElement.children ?? [], hostElement.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  }).filter((child) => child.id !== tabStripNode.id && !isDividerLikeListSeparator(child));
  if (siblings.length !== tabCount) {
    return [];
  }

  const stripY = toFiniteNumber(tabStripNode.y);
  const stripHeight = toFiniteNumber(tabStripNode.height);
  const stripBottom = stripY !== undefined && stripHeight !== undefined ? stripY + stripHeight : undefined;
  const hasInvalidPanels = siblings.some((candidate) => {
    const hasMeaningfulContent =
      hasMeaningfulTextDescendants({
        element: candidate,
        context
      }) || (candidate.children?.length ?? 0) > 0;
    if (!hasMeaningfulContent) {
      return true;
    }
    const candidateHeight = toFiniteNumber(candidate.height);
    if (candidateHeight !== undefined && candidateHeight < TAB_PATTERN_PANEL_MIN_CONTENT_HEIGHT_PX) {
      return true;
    }
    if (stripBottom === undefined) {
      return false;
    }
    const candidateY = toFiniteNumber(candidate.y);
    return candidateY !== undefined && candidateY < stripBottom - 8;
  });
  if (hasInvalidPanels) {
    return [];
  }
  return siblings;
};

const detectTabInterfacePattern = ({
  element,
  depth,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
}): DetectedTabInterfacePattern | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const dataTableLike = isLikelyStructuredDataTable({
    element,
    generationLocale: context.generationLocale
  });

  const directTabStripCandidate = toTabStripPatternCandidate({
    tabStripNode: element,
    context
  });
  if (directTabStripCandidate) {
    const hasPrimarySignal =
      hasTabNameHint(element) ||
      hasNavigationNameHintInSubtree(element) ||
      directTabStripCandidate.tabItems.some((tabItem) => tabItem.node.prototypeNavigation);
    if (dataTableLike && !hasPrimarySignal) {
      return undefined;
    }
    return {
      tabStripNode: element,
      tabItems: directTabStripCandidate.tabItems,
      panelNodes: []
    };
  }

  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  for (const child of sortedChildren) {
    const stripCandidate = toTabStripPatternCandidate({
      tabStripNode: child,
      context
    });
    if (!stripCandidate) {
      continue;
    }

    const hasPrimarySignal =
      hasTabNameHint(element) ||
      hasTabNameHint(child) ||
      stripCandidate.tabItems.some((tabItem) => tabItem.node.prototypeNavigation) ||
      hasNavigationNameHintInSubtree(child);
    if (dataTableLike && !hasPrimarySignal) {
      continue;
    }

    const panelNodes = resolveTabPanelNodes({
      hostElement: element,
      tabStripNode: child,
      tabCount: stripCandidate.tabItems.length,
      context
    });
    return {
      tabStripNode: child,
      tabItems: stripCandidate.tabItems,
      panelNodes
    };
  }

  return undefined;
};

const toHexColorAlpha = (value: string | undefined): number | undefined => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return undefined;
  }
  const payload = normalized.slice(1);
  if (payload.length !== 8) {
    return undefined;
  }
  const alpha = Number.parseInt(payload.slice(6, 8), 16);
  if (!Number.isFinite(alpha)) {
    return undefined;
  }
  return alpha / 255;
};

const hasSemiTransparentOverlaySignal = (element: ScreenElementIR): boolean => {
  const opacity = toFiniteNumber(element.opacity);
  if (opacity !== undefined && opacity < 0.96) {
    return true;
  }
  const fillAlpha = toHexColorAlpha(element.fillColor);
  return fillAlpha !== undefined && fillAlpha < 0.96;
};

const collectSubtreeElements = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element, ...(element.children ?? []).flatMap((child) => collectSubtreeElements(child, visited))];
};

const toElementBounds = (
  element: ScreenElementIR
):
  | {
      x: number;
      y: number;
      width: number;
      height: number;
      centerX: number;
      centerY: number;
    }
  | undefined => {
  const x = toFiniteNumber(element.x);
  const y = toFiniteNumber(element.y);
  const width = toFiniteNumber(element.width);
  const height = toFiniteNumber(element.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2
  };
};

const hasDialogHint = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = normalizeInputSemanticText(value);
  return normalized.includes("dialog") || normalized.includes("modal") || normalized.includes("overlay");
};

const isDialogActionLikeNode = ({
  node,
  context
}: {
  node: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (node.type === "button") {
    return true;
  }
  if (node.prototypeNavigation) {
    return true;
  }
  const semanticSignals = [node.name, firstText(node) ?? node.text ?? ""]
    .map((value) => normalizeInputSemanticText(value))
    .filter((value) => value.length > 0);
  if (semanticSignals.some((signal) => DIALOG_ACTION_HINTS.some((hint) => signal.includes(hint)))) {
    return true;
  }
  return hasInteractiveDescendants({ element: node, context });
};

const isDialogCloseControlNode = ({
  node,
  panelNode
}: {
  node: ScreenElementIR;
  panelNode: ScreenElementIR;
}): boolean => {
  const semanticSignals = [node.name, firstText(node) ?? node.text ?? ""]
    .map((value) => normalizeInputSemanticText(value))
    .filter((value) => value.length > 0);
  const hasCloseHint = semanticSignals.some((signal) => DIALOG_CLOSE_HINTS.some((hint) => signal.includes(hint)));
  const isControlLike =
    node.type === "button" || isIconLikeNode(node) || isSemanticIconWrapper(node) || Boolean(pickBestIconNode(node));
  if (!hasCloseHint && !isControlLike) {
    return false;
  }

  const panelBounds = toElementBounds(panelNode);
  const nodeBounds = toElementBounds(node);
  if (!panelBounds || !nodeBounds) {
    return hasCloseHint;
  }
  const isTopRight =
    nodeBounds.centerX >= panelBounds.x + panelBounds.width * 0.58 &&
    nodeBounds.centerY <= panelBounds.y + panelBounds.height * 0.35;
  return hasCloseHint || (isControlLike && isTopRight);
};

const resolveDialogActionModels = ({
  panelNode,
  context
}: {
  panelNode: ScreenElementIR;
  context: RenderContext;
}): {
  actionModels: DialogActionModel[];
  actionHostNodeId?: string;
} => {
  const panelChildren = sortChildren(panelNode.children ?? [], panelNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const bottomToTopChildren = [...panelChildren].reverse();
  for (const child of bottomToTopChildren) {
    if (child.layoutMode !== "HORIZONTAL") {
      continue;
    }
    const actionItems = collectRenderedItems(child, context.generationLocale).filter((item) =>
      isDialogActionLikeNode({
        node: item.node,
        context
      })
    );
    if (actionItems.length < TAB_PATTERN_MIN_ACTIONS) {
      continue;
    }
    return {
      actionHostNodeId: child.id,
      actionModels: actionItems.map((item, index) => ({
        id: item.id,
        label: item.label,
        isPrimary: index === actionItems.length - 1
      }))
    };
  }

  const directActionNodes = panelChildren.filter((child) =>
    isDialogActionLikeNode({
      node: child,
      context
    })
  );
  if (directActionNodes.length === 0) {
    return { actionModels: [] };
  }
  return {
    actionModels: directActionNodes.map((node, index) => ({
      id: node.id,
      label: firstText(node)?.trim() || node.name || `Action ${index + 1}`,
      isPrimary: index === directActionNodes.length - 1
    }))
  };
};

const resolveCenteredDialogPanelNode = ({
  overlayNode,
  context
}: {
  overlayNode: ScreenElementIR;
  context: RenderContext;
}): ScreenElementIR | undefined => {
  const overlayBounds = toElementBounds(overlayNode);
  if (!overlayBounds) {
    return undefined;
  }
  const sortedChildren = sortChildren(overlayNode.children ?? [], overlayNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  let bestMatch: {
    node: ScreenElementIR;
    score: number;
  } | undefined;
  for (const child of sortedChildren) {
    const childBounds = toElementBounds(child);
    if (!childBounds) {
      continue;
    }
    const widthRatio = childBounds.width / overlayBounds.width;
    const heightRatio = childBounds.height / overlayBounds.height;
    if (
      widthRatio < DIALOG_PATTERN_PANEL_MIN_WIDTH_RATIO ||
      widthRatio > DIALOG_PATTERN_PANEL_MAX_WIDTH_RATIO ||
      heightRatio < DIALOG_PATTERN_PANEL_MIN_HEIGHT_RATIO ||
      heightRatio > DIALOG_PATTERN_PANEL_MAX_HEIGHT_RATIO
    ) {
      continue;
    }

    const centerDeltaX = Math.abs(childBounds.centerX - overlayBounds.centerX);
    const centerDeltaY = Math.abs(childBounds.centerY - overlayBounds.centerY);
    const maxCenterDeltaX = Math.max(DIALOG_PATTERN_CENTER_TOLERANCE_PX, overlayBounds.width * DIALOG_PATTERN_CENTER_TOLERANCE_RATIO);
    const maxCenterDeltaY = Math.max(DIALOG_PATTERN_CENTER_TOLERANCE_PX, overlayBounds.height * DIALOG_PATTERN_CENTER_TOLERANCE_RATIO);
    if (centerDeltaX > maxCenterDeltaX || centerDeltaY > maxCenterDeltaY) {
      continue;
    }

    const hasVisualSignal = hasVisualStyle(child) || Boolean(child.fillColor || child.strokeColor || child.elevation);
    if (!hasVisualSignal) {
      continue;
    }
    const hasContentSignal =
      hasMeaningfulTextDescendants({
        element: child,
        context
      }) || (child.children?.length ?? 0) > 0;
    if (!hasContentSignal) {
      continue;
    }
    const score =
      centerDeltaX + centerDeltaY - Math.min(childBounds.width / overlayBounds.width, childBounds.height / overlayBounds.height);
    if (!bestMatch || score < bestMatch.score) {
      bestMatch = {
        node: child,
        score
      };
    }
  }
  return bestMatch?.node;
};

const detectDialogOverlayPattern = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): DetectedDialogOverlayPattern | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const elementWidth = toFiniteNumber(element.width);
  const elementHeight = toFiniteNumber(element.height);
  const parentWidth = toFiniteNumber(parent.width);
  const parentHeight = toFiniteNumber(parent.height);
  if (
    elementWidth === undefined ||
    elementHeight === undefined ||
    parentWidth === undefined ||
    parentHeight === undefined ||
    parentWidth <= 0 ||
    parentHeight <= 0
  ) {
    return undefined;
  }
  if (elementWidth / parentWidth < DIALOG_PATTERN_MIN_WIDTH_RATIO || elementHeight / parentHeight < DIALOG_PATTERN_MIN_HEIGHT_RATIO) {
    return undefined;
  }
  const hasOverlaySignal = hasSemiTransparentOverlaySignal(element);
  if (!hasOverlaySignal) {
    return undefined;
  }

  const panelNode = resolveCenteredDialogPanelNode({
    overlayNode: element,
    context
  });
  if (!panelNode) {
    return undefined;
  }

  const extraction = resolveDialogActionModels({
    panelNode,
    context
  });
  const closeControls = collectSubtreeElements(panelNode).filter((candidate) =>
    isDialogCloseControlNode({
      node: candidate,
      panelNode
    })
  );
  const hasCloseControl = closeControls.length > 0;
  const hasDialogSemanticHint = hasDialogHint(element.name) || hasDialogHint(panelNode.name);
  if (!hasDialogSemanticHint && !hasCloseControl && extraction.actionModels.length < TAB_PATTERN_MIN_ACTIONS) {
    return undefined;
  }

  const contentNodes = sortChildren(panelNode.children ?? [], panelNode.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  }).filter((child) => child.id !== extraction.actionHostNodeId && !closeControls.some((closeNode) => closeNode.id === child.id));
  const hasContentSignal =
    contentNodes.some((node) =>
      hasMeaningfulTextDescendants({
        element: node,
        context
      })
    ) || hasMeaningfulTextDescendants({ element: panelNode, context });
  if (!hasContentSignal) {
    return undefined;
  }
  const title = firstText(contentNodes[0] ?? panelNode)?.trim();
  return {
    panelNode,
    title,
    contentNodes,
    actionModels: extraction.actionModels
  };
};

const detectNavigationBarPattern = ({
  element,
  depth,
  parent,
  context
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}): "appbar" | "navigation" | undefined => {
  if (depth !== NAVIGATION_BAR_TOP_LEVEL_DEPTH) {
    return undefined;
  }
  if (!NAVIGATION_BAR_CANDIDATE_TYPES.has(element.type)) {
    return undefined;
  }

  const elementWidth = toFiniteNumber(element.width);
  const elementHeight = toFiniteNumber(element.height);
  const parentWidth = toFiniteNumber(parent.width);
  const parentHeight = toFiniteNumber(parent.height);
  const elementY = toFiniteNumber(element.y);
  const parentY = toFiniteNumber(parent.y);

  if (
    elementWidth === undefined ||
    elementHeight === undefined ||
    parentWidth === undefined ||
    parentHeight === undefined ||
    elementY === undefined ||
    parentY === undefined ||
    parentWidth <= 0 ||
    parentHeight <= 0
  ) {
    return undefined;
  }

  if (elementHeight < NAVIGATION_BAR_MIN_HEIGHT_PX || elementHeight > NAVIGATION_BAR_MAX_HEIGHT_PX) {
    return undefined;
  }

  const widthRatio = elementWidth / parentWidth;
  if (widthRatio < NAVIGATION_BAR_MIN_WIDTH_RATIO) {
    return undefined;
  }

  const topDistance = Math.abs(elementY - parentY);
  const bottomDistance = Math.abs(parentY + parentHeight - (elementY + elementHeight));
  const isNearTop = topDistance <= NAVIGATION_BAR_EDGE_PROXIMITY_PX;
  const isNearBottom = bottomDistance <= NAVIGATION_BAR_EDGE_PROXIMITY_PX;
  if (!isNearTop && !isNearBottom) {
    return undefined;
  }

  const hasTitleSignal = Boolean(firstText(element)?.trim());
  const hasIconSignal = collectIconNodes(element).length > 0 || Boolean(pickBestIconNode(element));
  const hasInteractiveSignal =
    hasInteractiveDescendants({ element, context }) || hasPrototypeNavigationInSubtree(element);
  const hasNavigationHintSignal = hasNavigationNameHintInSubtree(element);
  const hasPrimaryNavSignal = hasIconSignal || hasInteractiveSignal || hasNavigationHintSignal;

  if (
    isLikelyStructuredDataTable({
      element,
      generationLocale: context.generationLocale
    }) &&
    !hasPrimaryNavSignal
  ) {
    return undefined;
  }

  if (isNearBottom) {
    const renderableActionCount = collectRenderedItems(element, context.generationLocale).filter((action) =>
      isRenderableBottomNavigationAction({
        action,
        context
      })
    ).length;
    if (renderableActionCount >= NAVIGATION_BAR_MIN_RENDERABLE_BOTTOM_ACTIONS && hasPrimaryNavSignal) {
      return "navigation";
    }
  }

  if (isNearTop && hasTitleSignal && hasPrimaryNavSignal) {
    return "appbar";
  }
  return undefined;
};

const GRID_CLUSTER_TOLERANCE_PX = 18;
const GRID_MATRIX_MIN_CHILDREN = 4;
const GRID_EQUAL_ROW_MIN_CHILDREN = 3;
const GRID_EQUAL_WIDTH_CV_THRESHOLD = 0.14;
const GRID_EQUAL_WIDTH_DELTA_THRESHOLD_PX = 24;
const GRID_MATRIX_MIN_OCCUPANCY = 0.55;

interface GridLayoutDetection {
  mode: "matrix" | "equal-row";
  columnCount: number;
}

const isFiniteNumber = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const clusterAxisValues = ({ values, tolerance }: { values: number[]; tolerance: number }): number[] => {
  if (values.length === 0) {
    return [];
  }
  const sortedValues = [...values].sort((left, right) => left - right);
  const clusters: Array<{ center: number; count: number }> = [];
  for (const value of sortedValues) {
    const current = clusters.at(-1);
    if (!current || Math.abs(value - current.center) > tolerance) {
      clusters.push({ center: value, count: 1 });
      continue;
    }
    const nextCount = current.count + 1;
    current.center = (current.center * current.count + value) / nextCount;
    current.count = nextCount;
  }
  return clusters.map((cluster) => cluster.center);
};

const toNearestClusterIndex = ({ value, clusters }: { value: number; clusters: number[] }): number => {
  if (clusters.length <= 1) {
    return 0;
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(value - clusters[0]!);
  for (let index = 1; index < clusters.length; index += 1) {
    const candidate = clusters[index];
    if (candidate === undefined) {
      continue;
    }
    const distance = Math.abs(value - candidate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};

const detectGridLikeContainerLayout = (element: ScreenElementIR): GridLayoutDetection | null => {
  if (element.type !== "container") {
    return null;
  }
  if ((element.layoutMode ?? "NONE") !== "NONE") {
    return null;
  }

  const children = sortChildren(element.children ?? [], "NONE");
  if (children.length < GRID_EQUAL_ROW_MIN_CHILDREN) {
    return null;
  }

  const positionedChildren = children.filter((child) => isFiniteNumber(child.x) && isFiniteNumber(child.y));
  if (positionedChildren.length !== children.length) {
    return null;
  }

  const rowClusters = clusterAxisValues({
    values: positionedChildren.map((child) => child.y ?? 0),
    tolerance: GRID_CLUSTER_TOLERANCE_PX
  });
  const columnClusters = clusterAxisValues({
    values: positionedChildren.map((child) => child.x ?? 0),
    tolerance: GRID_CLUSTER_TOLERANCE_PX
  });

  if (children.length >= GRID_MATRIX_MIN_CHILDREN && rowClusters.length >= 2 && columnClusters.length >= 2) {
    const rowCounts = new Array<number>(rowClusters.length).fill(0);
    const columnCounts = new Array<number>(columnClusters.length).fill(0);
    for (const child of positionedChildren) {
      const rowIndex = toNearestClusterIndex({
        value: child.y ?? 0,
        clusters: rowClusters
      });
      const columnIndex = toNearestClusterIndex({
        value: child.x ?? 0,
        clusters: columnClusters
      });
      rowCounts[rowIndex] = (rowCounts[rowIndex] ?? 0) + 1;
      columnCounts[columnIndex] = (columnCounts[columnIndex] ?? 0) + 1;
    }
    const minRowItems = Math.min(...rowCounts);
    const minColumnItems = Math.min(...columnCounts);
    const occupancy = positionedChildren.length / Math.max(1, rowClusters.length * columnClusters.length);
    if (minRowItems >= 2 && minColumnItems >= 2 && occupancy >= GRID_MATRIX_MIN_OCCUPANCY) {
      return {
        mode: "matrix",
        columnCount: columnClusters.length
      };
    }
  }

  if (children.length < GRID_EQUAL_ROW_MIN_CHILDREN || rowClusters.length !== 1 || columnClusters.length < GRID_EQUAL_ROW_MIN_CHILDREN) {
    return null;
  }
  const childWidths = positionedChildren
    .map((child) => child.width)
    .filter((width): width is number => isFiniteNumber(width) && width > 0);
  if (childWidths.length !== positionedChildren.length) {
    return null;
  }

  const minWidth = Math.min(...childWidths);
  const maxWidth = Math.max(...childWidths);
  const averageWidth = childWidths.reduce((total, width) => total + width, 0) / childWidths.length;
  const widthVariance = childWidths.reduce((total, width) => total + (width - averageWidth) ** 2, 0) / childWidths.length;
  const widthCv = averageWidth > 0 ? Math.sqrt(widthVariance) / averageWidth : Number.POSITIVE_INFINITY;
  const hasEqualWidths =
    widthCv <= GRID_EQUAL_WIDTH_CV_THRESHOLD || maxWidth - minWidth <= GRID_EQUAL_WIDTH_DELTA_THRESHOLD_PX;

  if (!hasEqualWidths) {
    return null;
  }

  return {
    mode: "equal-row",
    columnCount: columnClusters.length
  };
};

const renderGridLayout = ({
  element,
  depth,
  parent,
  context,
  includePaints,
  equalColumns = false,
  columnCountHint
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  includePaints: boolean;
  equalColumns?: boolean;
  columnCountHint?: number;
}): string | null => {
  const items = collectRenderedItems(element, context.generationLocale);
  if (items.length < 2) {
    return null;
  }

  registerMuiImports(context, "Grid");
  const indent = "  ".repeat(depth);
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 2
      : 2;
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints
  });

  const normalizedChildWidths = items.map((item) => Math.max(1, item.node.width ?? 0));
  const totalChildWidth = normalizedChildWidths.reduce((total, width) => total + width, 0);
  const normalizedColumnHint =
    typeof columnCountHint === "number" && Number.isFinite(columnCountHint) && columnCountHint > 0
      ? Math.min(Math.max(1, Math.round(columnCountHint)), items.length)
      : items.length;
  const referenceRowWidth =
    normalizedColumnHint > 1 && items.length > normalizedColumnHint
      ? Math.max(1, totalChildWidth / Math.max(1, Math.ceil(items.length / normalizedColumnHint)))
      : Math.max(1, totalChildWidth);

  const renderedItems = items
    .map((item, index) => {
      const fallbackWidth = normalizedChildWidths[index] ?? 1;
      const mdSize = equalColumns
        ? clamp(Math.round(12 / normalizedColumnHint), 1, 12)
        : clamp(Math.round((fallbackWidth / referenceRowWidth) * 12), 1, 12);
      const smSize = normalizedColumnHint <= 2 ? mdSize : Math.max(6, mdSize);
      const childContent = renderElement(
        item.node,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      );
      const resolvedChildContent = childContent ?? (() => {
        registerMuiImports(context, "Box");
        return `${indent}    <Box />`;
      })();
      return `${indent}  <Grid key={${literal(item.id)}} size={{ xs: 12, sm: ${smSize}, md: ${mdSize} }}>
${resolvedChildContent}
${indent}  </Grid>`;
    })
    .join("\n");

  return `${indent}<Grid container spacing={${spacing}} sx={{ ${sx} }}>
${renderedItems}
${indent}</Grid>`;
};

const sanitizeSelectOptionValue = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Option";
};

const toMuiContainerMaxWidth = (contentWidth: number): "sm" | "md" | "lg" | "xl" => {
  if (contentWidth <= 600) {
    return "sm";
  }
  if (contentWidth <= 900) {
    return "md";
  }
  if (contentWidth <= 1200) {
    return "lg";
  }
  if (contentWidth <= 1536) {
    return "xl";
  }
  return "xl";
};

const toAlertSeverityFromName = (name: string): "error" | "warning" | "info" | "success" => {
  const normalized = name.toLowerCase();
  if (normalized.includes("error")) {
    return "error";
  }
  if (normalized.includes("warn")) {
    return "warning";
  }
  if (normalized.includes("success")) {
    return "success";
  }
  return "info";
};

const renderCard = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  if ((element.children?.length ?? 0) === 0 && !hasVisualStyle(element)) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Card", "CardContent");
  const indent = "  ".repeat(depth);
  const cardElevation = normalizeElevationForSx(element.elevation);
  const sx = toElementSx({
    element,
    parent,
    context,
    preferInsetShadow: false
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const elevationProp = typeof cardElevation === "number" && cardElevation > 0 ? ` elevation={${cardElevation}}` : "";
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  const mediaCandidate = sortedChildren.find((child) => child.type === "image" || child.name.toLowerCase().includes("media"));
  const actionCandidates = sortedChildren.filter((child) => {
    if (child.type === "button") {
      return true;
    }
    const loweredName = child.name.toLowerCase();
    return loweredName.includes("action") || loweredName.includes("cta");
  });
  const bodyChildren = sortedChildren.filter((child) => {
    if (child.id === mediaCandidate?.id) {
      return false;
    }
    return !actionCandidates.some((candidate) => candidate.id === child.id);
  });

  const contentElement: ScreenElementIR = {
    ...element,
    children: bodyChildren
  };
  const actionsElement: ScreenElementIR = {
    ...element,
    children: actionCandidates
  };
  const mediaSx = mediaCandidate
    ? sxString([
        ["height", toPxLiteral(mediaCandidate.height ?? 140)],
        ["objectFit", literal("cover")],
        ["display", literal("block")]
      ])
    : undefined;
  if (mediaCandidate) {
    registerMuiImports(context, "CardMedia");
  }
  if (actionCandidates.length > 0) {
    registerMuiImports(context, "CardActions");
  }

  const renderedChildren = renderChildrenIntoParent({
    element: contentElement,
    depth: depth + 2,
    context
  });
  const renderedActions = renderChildrenIntoParent({
    element: actionsElement,
    depth: depth + 2,
    context
  });
  const contentBlock = renderedChildren.trim()
    ? `${indent}  <CardContent>\n${renderedChildren}\n${indent}  </CardContent>`
    : `${indent}  <CardContent />`;
  const mediaBlock = mediaCandidate
    ? (() => {
        const mediaLabel = resolveElementA11yLabel({ element: mediaCandidate, fallback: "Image" });
        const mediaSource = resolveImageSource({
          element: mediaCandidate,
          context,
          fallbackLabel: mediaLabel
        });
        if (isDecorativeImageElement(mediaCandidate)) {
          return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt="" aria-hidden="true" sx={{ ${mediaSx} }} />\n`;
        }
        return `${indent}  <CardMedia component="img" image={${literal(mediaSource)}} alt={${literal(mediaLabel)}} sx={{ ${mediaSx} }} />\n`;
      })()
    : "";
  const actionsBlock = renderedActions.trim() ? `\n${indent}  <CardActions>\n${renderedActions}\n${indent}  </CardActions>` : "";
  const roleProp = navigationProps?.roleProp ?? "";
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  return `${indent}<Card${elevationProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp} sx={{ ${sx} }}>
${mediaBlock}${contentBlock}${actionsBlock}
${indent}</Card>`;
};

const renderChip = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Chip");
  const indent = "  ".repeat(depth);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const sx = appendVariantStateOverridesToSx({
    sx: toElementSx({
      element,
      parent,
      context
    }),
    element,
    tokens: context.tokens
  });
  const label = firstText(element)?.trim() || element.name;
  const chipVariant = toChipVariant(mappedMuiProps?.variant);
  const chipSize = toChipSize(mappedMuiProps?.size);
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const variantProp = chipVariant ? ` variant="${chipVariant}"` : "";
  const sizeProp = chipSize ? ` size="${chipSize}"` : "";
  const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
  const linkProps = navigation && !mappedMuiProps?.disabled ? toRouterLinkProps({ navigation, context }) : "";
  return `${indent}<Chip label={${literal(label)}}${linkProps}${variantProp}${sizeProp}${disabledProp} sx={{ ${sx} }} />`;
};

const renderSelectionControl = ({
  element,
  depth,
  parent,
  context,
  componentName
}: {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
  componentName: "Switch" | "Checkbox" | "Radio";
}): string | null => {
  const nonTextChildCount = (element.children ?? []).filter((child) => child.type !== "text").length;
  if (nonTextChildCount > 1) {
    return renderContainer(element, depth, parent, context);
  }
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  if (componentName === "Radio") {
    const options = collectRenderedItems(element, context.generationLocale);
    if (options.length > 1) {
      registerMuiImports(context, "RadioGroup", "FormControlLabel", "Radio");
      const renderedOptions = options
        .map(
          (option, index) =>
            `${indent}  <FormControlLabel value=${literal(option.id)} control={<Radio />} label={${literal(option.label)}} />${
              index === options.length - 1 ? "" : ""
            }`
        )
        .join("\n");
      return `${indent}<RadioGroup defaultValue=${literal(options[0]?.id ?? "")} sx={{ ${sx} }}>
${renderedOptions}
${indent}</RadioGroup>`;
    }
  }
  const label = firstText(element)?.trim();
  registerMuiImports(context, componentName);
  if (label) {
    registerMuiImports(context, "FormControlLabel");
    return `${indent}<FormControlLabel sx={{ ${sx} }} control={<${componentName} />} label={${literal(label)}} />`;
  }
  return `${indent}<${componentName} sx={{ ${sx} }} />`;
};

const renderList = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const collectedRows = collectListRows(element, context.generationLocale);
  if (collectedRows.rowNodes.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  const rows = collectedRows.rowNodes.map((row) =>
    analyzeListRow({
      row,
      generationLocale: context.generationLocale
    })
  );
  return renderListFromRows({
    element,
    rows,
    hasInterItemDivider: collectedRows.hasInterItemDivider,
    depth,
    parent,
    context
  });
};

const isLikelyAppBarToolbarActionNode = ({
  node,
  context
}: {
  node: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  if (node.type === "button" || node.type === "navigation" || node.type === "tab") {
    return true;
  }
  if (node.prototypeNavigation) {
    return true;
  }
  if (isIconLikeNode(node) || isSemanticIconWrapper(node) || Boolean(pickBestIconNode(node))) {
    return true;
  }
  return hasInteractiveDescendants({ element: node, context });
};

interface AppBarToolbarActionModel {
  node: ScreenElementIR;
  iconNode: ScreenElementIR;
  ariaLabel: string;
}

const renderStructuredAppBarToolbarChildren = ({
  element,
  depth,
  context,
  fallbackTitle
}: {
  element: ScreenElementIR;
  depth: number;
  context: RenderContext;
  fallbackTitle: string;
}): string | undefined => {
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });
  if (children.length === 0) {
    return undefined;
  }

  const titleNode =
    children.find((child) => child.type === "text" && Boolean(child.text?.trim())) ??
    children.find((child) => {
      if (isLikelyAppBarToolbarActionNode({ node: child, context })) {
        return false;
      }
      return hasMeaningfulTextDescendants({ element: child, context });
    });
  const title = titleNode ? firstText(titleNode)?.trim() : fallbackTitle;
  if (!title) {
    return undefined;
  }

  const toolbarActions = children
    .filter((child) => child.id !== titleNode?.id)
    .map((child) => {
      if (!isLikelyAppBarToolbarActionNode({ node: child, context })) {
        return undefined;
      }
      const iconNode = isIconLikeNode(child) || isSemanticIconWrapper(child) ? child : pickBestIconNode(child);
      if (!iconNode) {
        return undefined;
      }
      return {
        node: child,
        iconNode,
        ariaLabel: resolveIconButtonAriaLabel({
          element: child,
          iconNode
        })
      } satisfies AppBarToolbarActionModel;
    })
    .filter((action): action is AppBarToolbarActionModel => Boolean(action));

  if (toolbarActions.length === 0) {
    return undefined;
  }

  const unstructuredChildren = children.filter(
    (child) => child.id !== titleNode?.id && !toolbarActions.some((action) => action.node.id === child.id)
  );
  if (unstructuredChildren.length > 0) {
    return undefined;
  }

  registerMuiImports(context, "IconButton");
  const indent = "  ".repeat(depth);
  const renderedActions = toolbarActions
    .map((action) => {
      const navigation = resolvePrototypeNavigationBinding({ element: action.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      const iconExpression = renderFallbackIconExpression({
        element: action.iconNode,
        parent: { name: action.node.name },
        context,
        ariaHidden: true,
        extraEntries: [["fontSize", literal("inherit")]]
      });
      return `${indent}    <IconButton edge="end" aria-label={${literal(action.ariaLabel)}}${linkProps}>${iconExpression}</IconButton>`;
    })
    .join("\n");
  return `${indent}    <Typography variant="h6" sx={{ flexGrow: 1 }}>{${literal(title)}}</Typography>\n${renderedActions}`;
};

const renderAppBar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "AppBar", "Toolbar", "Typography");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const fallbackTitle = firstText(element)?.trim() || element.name || "App";
  const structuredToolbarChildren = renderStructuredAppBarToolbarChildren({
    element,
    depth,
    context,
    fallbackTitle
  });
  const renderedChildren =
    structuredToolbarChildren ??
    renderChildrenIntoParent({
      element,
      depth: depth + 2,
      context
    });
  return `${indent}<AppBar role="banner" position="static" sx={{ ${sx} }}>
${indent}  <Toolbar>
${renderedChildren || `${indent}    <Typography variant="h6">{${literal(fallbackTitle)}}</Typography>`}
${indent}  </Toolbar>
${indent}</AppBar>`;
};

const renderTabs = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext,
  detectedPattern?: DetectedTabInterfacePattern
): string | null => {
  const resolvedPattern = detectedPattern;
  const tabItems =
    resolvedPattern?.tabItems ??
    collectRenderedItems(element, context.generationLocale).filter((action) =>
      isRenderableTabAction({
        action,
        context
      })
    );
  if (tabItems.length === 0) {
    return renderContainer(element, depth, parent, context);
  }

  const tabsStateModel = ensureTabsStateModel({
    element,
    context
  });
  const tabValueVar = `tabValue${tabsStateModel.stateId}`;
  const tabChangeHandlerVar = `handleTabChange${tabsStateModel.stateId}`;
  const tabStripNode = resolvedPattern?.tabStripNode ?? element;
  const panelNodes = resolvedPattern?.panelNodes ?? [];

  registerMuiImports(context, "Tabs", "Tab");
  if (panelNodes.length === tabItems.length && panelNodes.length > 0) {
    registerMuiImports(context, "Box");
  }
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element: tabStripNode,
    parent,
    context
  });
  const renderedTabs = tabItems
    .map((tab, index) => {
      const navigation = resolvePrototypeNavigationBinding({ element: tab.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      return `${indent}  <Tab key={${literal(tab.id)}} value={${index}} label={${literal(tab.label)}}${linkProps} />`;
    })
    .join("\n");
  const renderedPanels =
    panelNodes.length === tabItems.length && panelNodes.length > 0
      ? panelNodes
          .map((panelNode, index) => {
            const panelContent =
              renderElement(
                panelNode,
                depth + 2,
                {
                  x: element.x,
                  y: element.y,
                  width: element.width,
                  height: element.height,
                  name: element.name,
                  fillColor: element.fillColor,
                  fillGradient: element.fillGradient,
                  layoutMode: element.layoutMode ?? "NONE"
                },
                context
              ) ?? `${indent}    <Box />`;
            return `${indent}  <Box key={${literal(panelNode.id)}} role="tabpanel" hidden={${tabValueVar} !== ${index}} sx={{ pt: 2 }}>
${panelContent}
${indent}  </Box>`;
          })
          .join("\n")
      : "";
  return `${indent}<Tabs value={${tabValueVar}} onChange={${tabChangeHandlerVar}} sx={{ ${sx} }}>
${renderedTabs}
${indent}</Tabs>${renderedPanels ? `\n${renderedPanels}` : ""}`;
};

const renderDialog = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext,
  detectedPattern?: DetectedDialogOverlayPattern
): string | null => {
  const dialogStateModel = ensureDialogStateModel({
    element,
    context
  });
  const dialogOpenVar = `isDialogOpen${dialogStateModel.stateId}`;
  const dialogCloseHandlerVar = `handleDialogClose${dialogStateModel.stateId}`;
  const indent = "  ".repeat(depth);

  if (detectedPattern) {
    registerMuiImports(context, "Dialog", "DialogTitle", "DialogContent");
    if (detectedPattern.actionModels.length > 0) {
      registerMuiImports(context, "DialogActions", "Button");
    }
    const sx = toElementSx({
      element: detectedPattern.panelNode,
      parent: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        name: element.name,
        fillColor: element.fillColor,
        fillGradient: element.fillGradient,
        layoutMode: element.layoutMode ?? "NONE"
      },
      context
    });
    const renderedContent = renderNodesIntoParent({
      nodes: detectedPattern.contentNodes,
      parent: detectedPattern.panelNode,
      depth: depth + 2,
      context,
      layoutMode: detectedPattern.panelNode.layoutMode ?? "NONE"
    });
    const contentBlock = renderedContent.trim()
      ? `${indent}  <DialogContent>\n${renderedContent}\n${indent}  </DialogContent>`
      : `${indent}  <DialogContent />`;
    const renderedActions =
      detectedPattern.actionModels.length > 0
        ? detectedPattern.actionModels
            .map((actionModel) => {
              const variantProp = actionModel.isPrimary ? ' variant="contained"' : "";
              return `${indent}    <Button key={${literal(actionModel.id)}} onClick={${dialogCloseHandlerVar}}${variantProp}>{${literal(actionModel.label)}}</Button>`;
            })
            .join("\n")
        : "";
    const actionsBlock = renderedActions ? `\n${indent}  <DialogActions>\n${renderedActions}\n${indent}  </DialogActions>` : "";
    return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}} sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${detectedPattern.title ? `${indent}  <DialogTitle>{${literal(detectedPattern.title)}}</DialogTitle>\n` : ""}${contentBlock}${actionsBlock}
${indent}</Dialog>`;
  }

  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 2,
    context
  });
  const title = firstText(element)?.trim();
  if (!renderedChildren.trim() && !title) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Dialog", "DialogTitle", "DialogContent");
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const contentBlock = renderedChildren.trim()
    ? `${indent}  <DialogContent>\n${renderedChildren}\n${indent}  </DialogContent>`
    : `${indent}  <DialogContent />`;
  return `${indent}<Dialog open={${dialogOpenVar}} onClose={${dialogCloseHandlerVar}} sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${title ? `${indent}  <DialogTitle>{${literal(title)}}</DialogTitle>\n` : ""}${contentBlock}
${indent}</Dialog>`;
};

const renderStepper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const steps = collectRenderedItemLabels(element, context.generationLocale);
  if (steps.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Stepper", "Step", "StepLabel");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedSteps = steps
    .map((step, index) => `${indent}  <Step key={${literal(step.id)}} completed={${index < 1 ? "true" : "false"}}><StepLabel>{${literal(step.label)}}</StepLabel></Step>`)
    .join("\n");
  return `${indent}<Stepper activeStep={0} sx={{ ${sx} }}>
${renderedSteps}
${indent}</Stepper>`;
};

const renderProgress = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const isLinear = width >= Math.max(48, height * 2);
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  if (isLinear) {
    registerMuiImports(context, "LinearProgress");
    return `${indent}<LinearProgress variant="determinate" value={65} sx={{ ${sx} }} />`;
  }
  registerMuiImports(context, "CircularProgress");
  return `${indent}<CircularProgress variant="determinate" value={65} sx={{ ${sx} }} />`;
};

const renderAvatar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const content = firstText(element)?.trim();
  if (!content && !hasVisualStyle(element) && (element.children?.length ?? 0) === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Avatar");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  return `${indent}<Avatar sx={{ ${sx} }}>${content ? `{${literal(content)}}` : ""}</Avatar>`;
};

const renderBadge = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Badge", "Box");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const badgeContent = firstText(element)?.trim() || " ";
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  return `${indent}<Badge badgeContent={${literal(badgeContent)}} color="primary" sx={{ ${sx} }}>
${renderedChildren || `${indent}  <Box sx={{ width: "20px", height: "20px" }} />`}
${indent}</Badge>`;
};

const renderDividerElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Divider");
  const indent = "  ".repeat(depth);
  const sx = sxString([
    ...baseLayoutEntries(element, parent, {
      includePaints: false,
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase
    }),
    ["borderColor", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })]
  ]);
  return `${indent}<Divider aria-hidden="true" sx={{ ${sx} }} />`;
};

const renderNavigation = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const actions = collectRenderedItems(element, context.generationLocale);
  if (actions.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "BottomNavigation", "BottomNavigationAction");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedActions = actions
    .map((action, index) => {
      const navigation = resolvePrototypeNavigationBinding({ element: action.node, context });
      const linkProps = navigation ? toRouterLinkProps({ navigation, context }) : "";
      return `${indent}  <BottomNavigationAction key={${literal(action.id)}} value={${index}} label={${literal(action.label)}}${linkProps} />`;
    })
    .join("\n");
  return `${indent}<BottomNavigation role="navigation" showLabels value={0} sx={{ ${sx} }}>
${renderedActions}
${indent}</BottomNavigation>`;
};

const renderGrid = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const rendered = renderGridLayout({
    element,
    depth,
    parent,
    context,
    includePaints: false
  });
  if (rendered) {
    return rendered;
  }
  return renderContainer(element, depth, parent, context);
};

const renderStack = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  if ((element.children?.length ?? 0) === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Stack");
  const indent = "  ".repeat(depth);
  const direction = element.layoutMode === "HORIZONTAL" ? "row" : "column";
  const spacing =
    typeof element.gap === "number" && element.gap > 0
      ? toSpacingUnitValue({ value: element.gap, spacingBase: context.spacingBase }) ?? 0
      : 0;
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = landmarkRole ? ` role="${landmarkRole}"` : "";
  const ariaHiddenProp = isDecorative ? ' aria-hidden="true"' : "";
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }
  return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}}${roleProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Stack>`;
};

const renderPaper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Paper");
  const indent = "  ".repeat(depth);
  const elevation = normalizeElevationForSx(element.elevation);
  const variant = elevation && elevation > 0 ? undefined : element.strokeColor ? "outlined" : undefined;
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  const elevationProp = typeof elevation === "number" && elevation > 0 ? ` elevation={${elevation}}` : "";
  const variantProp = variant ? ` variant="${variant}"` : "";
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : "");
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";
  if (!renderedChildren.trim()) {
    return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }
  return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Paper>`;
};

const subtreeContainsElementType = (element: ScreenElementIR, targetType: ScreenElementIR["type"]): boolean => {
  if (element.type === targetType) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsElementType(child, targetType));
};

const renderTable = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const rows = sortChildren(element.children ?? [], element.layoutMode ?? "VERTICAL", {
    generationLocale: context.generationLocale
  })
    .map((row) => {
      const rowChildren = sortChildren(row.children ?? [], row.layoutMode ?? "HORIZONTAL", {
        generationLocale: context.generationLocale
      });
      if (rowChildren.length === 0) {
        return [row];
      }
      return rowChildren;
    })
    .filter((row) => row.length > 0);
  if (rows.length < 2 || rows.some((row) => row.length < 2)) {
    return renderContainer(element, depth, parent, context);
  }
  const containsImageCell = rows.some((row) => row.some((cell) => subtreeContainsElementType(cell, "image")));
  if (containsImageCell) {
    // Keep rich cell content (for example exported image assets) instead of flattening cells to plain strings.
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Table", "TableHead", "TableBody", "TableRow", "TableCell");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const headerCells = rows[0] ?? [];
  const bodyRows = rows.slice(1);
  const renderedHead = headerCells
    .map((cell) => `${indent}      <TableCell>{${literal(firstText(cell)?.trim() || cell.name)}}</TableCell>`)
    .join("\n");
  const renderedBody = bodyRows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => `${indent}      <TableCell>{${literal(firstText(cell)?.trim() || cell.name || `Row ${rowIndex + 1}`)}}</TableCell>`)
        .join("\n");
      return `${indent}    <TableRow>\n${cells}\n${indent}    </TableRow>`;
    })
    .join("\n");
  return `${indent}<Table size="small" sx={{ ${sx} }}>
${indent}  <TableHead>
${indent}    <TableRow>
${renderedHead}
${indent}    </TableRow>
${indent}  </TableHead>
${indent}  <TableBody>
${renderedBody}
${indent}  </TableBody>
${indent}</Table>`;
};

const renderTooltipElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Tooltip", "Box");
  const indent = "  ".repeat(depth);
  const title = firstText(element)?.trim() || element.name || "Info";
  const anchorNode = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  })[0];
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const anchorContent = anchorNode
    ? renderElement(
        anchorNode,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          fillColor: element.fillColor,
          fillGradient: element.fillGradient,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    : `${indent}    <Box sx={{ width: "24px", height: "24px" }} />`;
  return `${indent}<Tooltip title={${literal(title)}}>
${indent}  <Box sx={{ ${sx} }}>
${anchorContent}
${indent}  </Box>
${indent}</Tooltip>`;
};

const renderDrawer = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Drawer", "Box");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 2,
    context
  });
  return `${indent}<Drawer open variant="persistent" PaperProps={{ role: "navigation" }} sx={{ "& .MuiDrawer-paper": { ${sx} } }}>
${indent}  <Box sx={{ width: "100%" }}>
${renderedChildren || `${indent}    <Box />`}
${indent}  </Box>
${indent}</Drawer>`;
};

const renderBreadcrumbs = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const crumbs = collectRenderedItemLabels(element, context.generationLocale);
  if (crumbs.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Breadcrumbs", "Typography");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const renderedCrumbs = crumbs
    .map((crumb, index) => {
      const color = index === crumbs.length - 1 ? "text.primary" : "text.secondary";
      return `${indent}  <Typography key={${literal(crumb.id)}} color=${literal(color)}>{${literal(crumb.label)}}</Typography>`;
    })
    .join("\n");
  return `${indent}<Breadcrumbs sx={{ ${sx} }}>
${renderedCrumbs}
${indent}</Breadcrumbs>`;
};

const renderSlider = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Slider");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Slider defaultValue={65} valueLabelDisplay="auto" sx={{ ${sx} }} />`;
};

const renderSelectElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  const key = toStateKey(element);
  const existing = context.fields.find((field) => field.key === key);
  const optionsFromChildren = collectRenderedItems(element, context.generationLocale)
    .map((item) => sanitizeSelectOptionValue(item.label))
    .filter((value) => value.length > 0);
  const fallbackDefault = sanitizeSelectOptionValue(element.text?.trim() || firstText(element)?.trim() || "Option 1");
  const options =
    optionsFromChildren.length > 0
      ? [...new Set(optionsFromChildren)]
      : deriveSelectOptions(fallbackDefault, context.generationLocale);
  const rawLabel = firstText(element)?.trim() || element.name;
  const required = inferRequiredFromLabel(rawLabel);
  const sanitizedLabel = required ? sanitizeRequiredLabel(rawLabel) : rawLabel;
  const label = sanitizedLabel.length > 0 ? sanitizedLabel : rawLabel;
  const hasVisualErrorExample = inferVisualErrorFromOutline(element);
  const field: InteractiveFieldModel =
    existing ??
    (() => {
      const created: InteractiveFieldModel = {
        key,
        label,
        defaultValue: options[0] ?? fallbackDefault,
        isSelect: true,
        options,
        ...(required ? { required } : {}),
        ...(hasVisualErrorExample ? { hasVisualErrorExample } : {})
      };
      context.fields.push(created);
      return created;
    })();
  registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem", "FormHelperText");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const labelId = `${field.key}-label`;
  const helperTextId = `${field.key}-helper-text`;
  const fieldErrorExpression = `(Boolean((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? ""))`;
  const fieldHelperTextExpression = `((touchedFields[${literal(field.key)}] ? fieldErrors[${literal(field.key)}] : initialVisualErrors[${literal(field.key)}]) ?? "")`;
  const requiredProp = field.required ? `${indent}  required\n` : "";
  const ariaRequiredProp = field.required ? `${indent}    aria-required="true"\n` : "";
  return `${indent}<FormControl
${requiredProp}${indent}  error={${fieldErrorExpression}}
${indent}  sx={{ ${sx} }}
${indent}>
${indent}  <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(labelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
${indent}    onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}    aria-describedby={${literal(helperTextId)}}
${ariaRequiredProp}${indent}    aria-label={${literal(field.label)}}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
${indent}  <FormHelperText id={${literal(helperTextId)}}>{${fieldHelperTextExpression}}</FormHelperText>
${indent}</FormControl>`;
};

const renderRatingElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Rating");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Rating defaultValue={4} precision={0.5} sx={{ ${sx} }} />`;
};

const renderSnackbar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Snackbar", "Alert");
  const indent = "  ".repeat(depth);
  const message = firstText(element)?.trim() || element.name || "Hinweis";
  const severity = toAlertSeverityFromName(element.name);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
${indent}  <Alert severity="${severity}" sx={{ ${sx} }}>{${literal(message)}}</Alert>
${indent}</Snackbar>`;
};

const renderSkeleton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Skeleton");
  const indent = "  ".repeat(depth);
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const variant = height <= 24 ? "text" : width >= Math.max(24, height * 1.8) ? "rectangular" : "circular";
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  return `${indent}<Skeleton aria-hidden="true" variant="${variant}" sx={{ ${sx} }} />`;
};

const renderImageElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Box");
  const indent = "  ".repeat(depth);
  const sx = sxString([
    ...baseLayoutEntries(element, parent, {
      includePaints: false,
      spacingBase: context.spacingBase,
      tokens: context.tokens
    }),
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase
    }),
    ["objectFit", literal("cover")],
    ["display", literal("block")]
  ]);
  const ariaLabel = resolveElementA11yLabel({ element, fallback: "Image" });
  const src = resolveImageSource({
    element,
    context,
    fallbackLabel: ariaLabel
  });
  if (isDecorativeImageElement(element)) {
    return `${indent}<Box component="img" src={${literal(src)}} alt="" aria-hidden="true" sx={{ ${sx} }} />`;
  }
  return `${indent}<Box component="img" src={${literal(src)}} alt={${literal(ariaLabel)}} sx={{ ${sx} }} />`;
};

const renderContainer = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const indent = "  ".repeat(depth);
  if (isLikelyAccordionContainer(element)) {
    return renderSemanticAccordion(element, depth, parent, context);
  }

  if (isLikelyInputContainer(element)) {
    return renderSemanticInput(element, depth, parent, context);
  }

  if (isPillShapedOutlinedButton(element)) {
    return renderButton(element, depth, parent, context);
  }

  if ((isIconLikeNode(element) || isSemanticIconWrapper(element)) && !hasMeaningfulTextDescendants({ element, context })) {
    const iconExpression = renderFallbackIconExpression({
      element,
      parent,
      context,
      ariaHidden: true,
      extraEntries: [
        ...baseLayoutEntries(element, parent, {
          includePaints: false,
          spacingBase: context.spacingBase,
          tokens: context.tokens
        }),
        ...toResponsiveLayoutMediaEntries({
          baseLayoutMode: element.layoutMode ?? "NONE",
          overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
          spacingBase: context.spacingBase
        }),
        ["display", literal("flex")],
        ["alignItems", literal("center")],
        ["justifyContent", literal("center")]
      ]
    });
    return `${indent}${iconExpression}`;
  }

  const detectedGridLayout = detectGridLikeContainerLayout(element);
  if (detectedGridLayout) {
    const renderedGrid = renderGridLayout({
      element,
      depth,
      parent,
      context,
      includePaints: true,
      equalColumns: detectedGridLayout.mode === "equal-row",
      columnCountHint: detectedGridLayout.columnCount
    });
    if (renderedGrid) {
      return renderedGrid;
    }
  }

  if (isElevatedSurfaceContainerForPaper({ element, context })) {
    return renderPaper(element, depth, parent, context);
  }

  const detectedListPattern = detectRepeatedListPattern({
    element,
    generationLocale: context.generationLocale
  });
  if (detectedListPattern) {
    return renderListFromRows({
      element,
      rows: detectedListPattern.rows,
      hasInterItemDivider: detectedListPattern.hasInterItemDivider,
      depth,
      parent,
      context
    });
  }

  if (isSimpleFlexContainerForStack({ element, context })) {
    return renderSimpleFlexContainerAsStack({
      element,
      depth,
      parent,
      context
    });
  }

  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });

  const renderedChildren = children
    .map((child) => renderElement(child, depth + 1, {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      name: element.name,
      fillColor: element.fillColor,
      fillGradient: element.fillGradient,
      layoutMode: element.layoutMode ?? "NONE"
    }, context))
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const isDivider = (element.height ?? 0) <= 2 && Boolean(element.fillColor) && !children.length;
  if (isDivider) {
    const sx = sxString([
      ...baseLayoutEntries(element, parent, {
        spacingBase: context.spacingBase,
        tokens: context.tokens
      }),
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase
      }),
      ["borderColor", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })]
    ]);
    registerMuiImports(context, "Divider");
    return `${indent}<Divider aria-hidden="true" sx={{ ${sx} }} />`;
  }

  const sx = toElementSx({
    element,
    parent,
    context
  });
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : "");
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";

  if (!renderedChildren.trim()) {
    if (!hasVisualStyle(element) && !navigation) {
      return null;
    }
    registerMuiImports(context, "Box");
    return `${indent}<Box${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }} />`;
  }

  registerMuiImports(context, "Box");
  return `${indent}<Box${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Box>`;
};

const renderElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  context.renderNodeVisitCount += 1;
  if (context.renderNodeVisitCount > 200_000) {
    throw new Error(`Render traversal exceeded safety limit for screen '${context.screenName}'`);
  }
  if (context.activeRenderElements.has(element)) {
    return null;
  }
  context.activeRenderElements.add(element);
  try {
    const mappedElement = renderMappedElement(element, depth, parent, context);
    if (mappedElement) {
      return mappedElement;
    }

    if (element.nodeType === "VECTOR" && element.type !== "image") {
      return null;
    }

    const navigationBarPattern = detectNavigationBarPattern({
      element,
      depth,
      parent,
      context
    });
    if (navigationBarPattern === "appbar") {
      return renderAppBar(element, depth, parent, context);
    }
    if (navigationBarPattern === "navigation") {
      return renderNavigation(element, depth, parent, context);
    }

    const tabInterfacePattern = detectTabInterfacePattern({
      element,
      depth,
      context
    });
    if (tabInterfacePattern) {
      return renderTabs(element, depth, parent, context, tabInterfacePattern);
    }

    const dialogOverlayPattern = detectDialogOverlayPattern({
      element,
      depth,
      parent,
      context
    });
    if (dialogOverlayPattern) {
      return renderDialog(element, depth, parent, context, dialogOverlayPattern);
    }

    switch (element.type) {
      case "text":
        return renderText(element, depth, parent, context);
      case "input":
        return renderSemanticInput(element, depth, parent, context);
      case "select":
        return renderSelectElement(element, depth, parent, context);
      case "button":
        return renderButton(element, depth, parent, context);
      case "grid":
        return renderGrid(element, depth, parent, context);
      case "stack":
        return renderStack(element, depth, parent, context);
      case "paper":
        return renderPaper(element, depth, parent, context);
      case "card":
        return renderCard(element, depth, parent, context);
      case "chip":
        return renderChip(element, depth, parent, context);
      case "switch":
        return renderSelectionControl({
          element,
          depth,
          parent,
          context,
          componentName: "Switch"
        });
      case "checkbox":
        return renderSelectionControl({
          element,
          depth,
          parent,
          context,
          componentName: "Checkbox"
        });
      case "radio":
        return renderSelectionControl({
          element,
          depth,
          parent,
          context,
          componentName: "Radio"
        });
      case "slider":
        return renderSlider(element, depth, parent, context);
      case "rating":
        return renderRatingElement(element, depth, parent, context);
      case "list":
        return renderList(element, depth, parent, context);
      case "table":
        return renderTable(element, depth, parent, context);
      case "tooltip":
        return renderTooltipElement(element, depth, parent, context);
      case "appbar":
        return renderAppBar(element, depth, parent, context);
      case "drawer":
        return renderDrawer(element, depth, parent, context);
      case "breadcrumbs":
        return renderBreadcrumbs(element, depth, parent, context);
      case "tab":
        return renderTabs(element, depth, parent, context);
      case "dialog":
        return renderDialog(element, depth, parent, context);
      case "snackbar":
        return renderSnackbar(element, depth, parent, context);
      case "stepper":
        return renderStepper(element, depth, parent, context);
      case "progress":
        return renderProgress(element, depth, parent, context);
      case "skeleton":
        return renderSkeleton(element, depth, parent, context);
      case "avatar":
        return renderAvatar(element, depth, parent, context);
      case "badge":
        return renderBadge(element, depth, parent, context);
      case "divider":
        return renderDividerElement(element, depth, parent, context);
      case "navigation":
        return renderNavigation(element, depth, parent, context);
      case "image":
        return renderImageElement(element, depth, parent, context);
      case "container":
      default:
        return renderContainer(element, depth, parent, context);
    }
  } finally {
    context.activeRenderElements.delete(element);
  }
};

const fallbackThemeFile = (ir: DesignIR): GeneratedFile => {
  const tokens = ir.tokens;
  const lightPalette = toLightThemePalette(tokens);
  const darkPalette = toDarkThemePalette(tokens);
  const typographyEntries = DESIGN_TYPOGRAPHY_VARIANTS.map((variantName) => {
    const variant = tokens.typography[variantName];
    const entries = [
      ["fontSize", toRemLiteral(variant.fontSizePx)],
      ["fontWeight", Math.round(variant.fontWeight)],
      ["lineHeight", toRemLiteral(variant.lineHeightPx)],
      ["fontFamily", variant.fontFamily ? literal(variant.fontFamily) : undefined],
      ["letterSpacing", typeof variant.letterSpacingEm === "number" ? toEmLiteral(variant.letterSpacingEm) : undefined],
      ["textTransform", variant.textTransform ? literal(variant.textTransform) : undefined]
    ]
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return `    ${variantName}: { ${entries} }`;
  }).join(",\n");
  return {
    path: "src/theme/theme.ts",
    content: `import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  colorSchemes: {
    light: {
      palette: ${toThemePaletteBlock({ mode: "light", palette: lightPalette })}
    },
    dark: {
      palette: ${toThemePaletteBlock({ mode: "dark", palette: darkPalette })}
    }
  },
  shape: {
    borderRadius: ${Math.max(0, Math.round(tokens.borderRadius))}
  },
  spacing: ${Math.max(1, Math.round(tokens.spacingBase))},
  typography: {
    fontFamily: "${tokens.fontFamily}",
${typographyEntries}
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    }
  }
});
`
  };
};

interface FallbackScreenFileResult {
  file: GeneratedFile;
  prototypeNavigationRenderedCount: number;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  accessibilityWarnings: AccessibilityWarning[];
}

const toTruncationComment = (
  truncationMetric:
    | {
        originalElements: number;
        retainedElements: number;
        budget: number;
      }
    | undefined
): string => {
  if (!truncationMetric) {
    return "";
  }
  return `/* workspace-dev: Screen IR exceeded budget (${truncationMetric.originalElements} elements), truncated to ${truncationMetric.retainedElements} (budget ${truncationMetric.budget}). */\n`;
};

const fallbackScreenFile = ({
  screen,
  mappingByNodeId,
  spacingBase,
  tokens,
  iconResolver = ICON_FALLBACK_BUILTIN_RESOLVER,
  imageAssetMap = {},
  routePathByScreenId = new Map<string, string>(),
  generationLocale,
  truncationMetric,
  componentNameOverride,
  filePathOverride
}: {
  screen: ScreenIR;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  spacingBase?: number;
  tokens?: DesignTokens | undefined;
  iconResolver?: IconFallbackResolver;
  imageAssetMap?: Record<string, string>;
  routePathByScreenId?: Map<string, string>;
  generationLocale?: string;
  truncationMetric?: {
    originalElements: number;
    retainedElements: number;
    budget: number;
  };
  componentNameOverride?: string;
  filePathOverride?: string;
}): FallbackScreenFileResult => {
  const componentName = componentNameOverride ?? toComponentName(screen.name);
  const filePath = filePathOverride ?? toDeterministicScreenPath(screen.name);
  const truncationComment = toTruncationComment(truncationMetric);
  const resolvedSpacingBase = normalizeSpacingBase(spacingBase);
  const resolvedGenerationLocale = resolveGenerationLocale({
    requestedLocale: generationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  }).locale;

  const simplifiedChildren = simplifyElements(screen.children);
  const headingComponentByNodeId = inferHeadingComponentByNodeId(simplifiedChildren);
  const typographyVariantByNodeId = resolveTypographyVariantByNodeId({
    elements: simplifiedChildren,
    tokens
  });
  const minX = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.x ?? 0)) : 0;
  const minY = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.y ?? 0)) : 0;
  const renderContext: RenderContext = {
    screenId: screen.id,
    screenName: screen.name,
    generationLocale: resolvedGenerationLocale,
    fields: [],
    accordions: [],
    tabs: [],
    dialogs: [],
    buttons: [],
    activeRenderElements: new Set<ScreenElementIR>(),
    renderNodeVisitCount: 0,
    interactiveDescendantCache: new Map<string, boolean>(),
    meaningfulTextDescendantCache: new Map<string, boolean>(),
    headingComponentByNodeId,
    typographyVariantByNodeId,
    accessibilityWarnings: [],
    muiImports: new Set<string>(["Container"]),
    iconImports: [],
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    spacingBase: resolvedSpacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized: normalizeHexColor(screen.fillColor ?? tokens?.palette.background),
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  };

  const rendered = simplifiedChildren
    .map((element) =>
      renderElement(
        element,
        3,
        {
          x: minX,
          y: minY,
          width: screen.width,
          height: screen.height,
          name: screen.name,
          fillColor: screen.fillColor,
          fillGradient: screen.fillGradient,
          layoutMode: screen.layoutMode
        },
        renderContext
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
  const hasInteractiveFields = renderContext.fields.length > 0;
  const hasInteractiveAccordions = renderContext.accordions.length > 0;
  const hasSelectField = renderContext.fields.some((field) => field.isSelect);

  const contentWidth = clamp(
    Math.round(
      simplifiedChildren.reduce((maxWidth, element) => {
        if (typeof element.x === "number" && typeof element.width === "number") {
          return Math.max(maxWidth, element.x - minX + element.width);
        }
        if (typeof element.width !== "number") {
          return maxWidth;
        }
        return Math.max(maxWidth, element.width);
      }, 0)
    ),
    320,
    1680
  );

  const contentHeight = Math.max(
    320,
    Math.round(
      simplifiedChildren.reduce((maxHeight, element) => {
        if (typeof element.y !== "number" || typeof element.height !== "number") {
          return maxHeight;
        }
        return Math.max(maxHeight, element.y - minY + element.height);
      }, 0)
    )
  );
  const containerMaxWidth = toMuiContainerMaxWidth(contentWidth);
  const containerPadding = toSpacingUnitValue({ value: 16, spacingBase: renderContext.spacingBase }) ?? 2;
  const screenContainerSx = sxString([
    ["position", literal("relative")],
    ["width", literal("100%")],
    ["minHeight", literal(`max(100vh, ${contentHeight}px)`)],
    ["background", screen.fillGradient ? literal(screen.fillGradient) : undefined],
    [
      "bgcolor",
      !screen.fillGradient
        ? toThemeColorLiteral({ color: screen.fillColor ?? "background.default", tokens: renderContext.tokens })
        : undefined
    ],
    ["px", containerPadding],
    ["py", containerPadding],
    ...toScreenResponsiveRootMediaEntries({
      screen,
      spacingBase: renderContext.spacingBase
    })
  ]);

  const initialValues = Object.fromEntries(renderContext.fields.map((field) => [field.key, field.defaultValue]));
  const requiredFieldMap = Object.fromEntries(
    renderContext.fields.filter((field) => field.required).map((field) => [field.key, true])
  );
  const validationTypeMap = Object.fromEntries(
    renderContext.fields
      .filter((field) => field.validationType)
      .map((field) => [field.key, field.validationType as ValidationFieldType])
  );
  const validationMessageMap = Object.fromEntries(
    renderContext.fields
      .filter((field) => field.validationMessage)
      .map((field) => [field.key, field.validationMessage as string])
  );
  const initialVisualErrorsMap = Object.fromEntries(
    renderContext.fields
      .filter((field) => field.hasVisualErrorExample)
      .map((field) => [field.key, field.validationMessage ?? (field.required ? "This field is required." : "Invalid value.")])
  );
  const selectOptionsMap = Object.fromEntries(
    renderContext.fields.filter((field) => field.isSelect).map((field) => [field.key, field.options])
  );
  const initialAccordionState = Object.fromEntries(
    renderContext.accordions.map((accordion) => [accordion.key, accordion.defaultExpanded])
  );
  const preferredSubmitButton = renderContext.buttons.find((button) => button.eligibleForSubmit && button.preferredSubmit);
  const fallbackSubmitButton = renderContext.buttons.find((button) => button.eligibleForSubmit);
  const primarySubmitButtonKey = hasInteractiveFields
    ? (preferredSubmitButton?.key ?? fallbackSubmitButton?.key ?? "")
    : "";

  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  const submitButtonDeclaration =
    renderContext.buttons.length > 0 ? `const primarySubmitButtonKey = ${literal(primarySubmitButtonKey)};` : "";

  const fieldStateBlock = hasInteractiveFields
    ? `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};

const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(initialVisualErrors);
const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

const parseLocalizedNumber = (rawValue: string): number | undefined => {
  const compact = rawValue.replace(/\\s+/g, "");
  if (!compact) {
    return undefined;
  }
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);
  let normalized = compact;
  if (decimalIndex >= 0) {
    const integerPart = compact.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fractionPart = compact.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = integerPart.length > 0 ? \`\${integerPart}.\${fractionPart}\` : \`0.\${fractionPart}\`;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const validateFieldValue = (fieldKey: string, value: string): string => {
  const trimmed = value.trim();
  if (requiredFields[fieldKey] && trimmed.length === 0) {
    return "This field is required.";
  }
  if (trimmed.length === 0) {
    return "";
  }

  const validationType = fieldValidationTypes[fieldKey];
  if (!validationType) {
    return "";
  }
  const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

  switch (validationType) {
    case "email":
      return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed) ? "" : validationMessage;
    case "tel": {
      const compactTel = trimmed.replace(/\\s+/g, "");
      const digitCount = (compactTel.match(/\\d/g) ?? []).length;
      return /^\\+?[0-9().-]{6,24}$/.test(compactTel) && digitCount >= 6 ? "" : validationMessage;
    }
    case "url": {
      try {
        const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : \`https://\${trimmed}\`;
        const parsed = new URL(normalizedUrl);
        return parsed.hostname && parsed.hostname.includes(".") ? "" : validationMessage;
      } catch {
        return validationMessage;
      }
    }
    case "number":
      return parseLocalizedNumber(trimmed) !== undefined ? "" : validationMessage;
    case "date": {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
        return validationMessage;
      }
      const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
      if (![year, month, day].every((segment) => Number.isFinite(segment))) {
        return validationMessage;
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      const isValidDate =
        date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
      return isValidDate ? "" : validationMessage;
    }
    default:
      return "";
  }
};

const validateForm = (values: Record<string, string>): Record<string, string> => {
  return Object.keys(values).reduce<Record<string, string>>((nextErrors, fieldKey) => {
    nextErrors[fieldKey] = validateFieldValue(fieldKey, values[fieldKey] ?? "");
    return nextErrors;
  }, {});
};

const updateFieldValue = (fieldKey: string, value: string): void => {
  setFormValues((previous) => ({ ...previous, [fieldKey]: value }));
  if (!touchedFields[fieldKey]) {
    return;
  }
  const nextError = validateFieldValue(fieldKey, value);
  setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
};

const handleFieldBlur = (fieldKey: string): void => {
  setTouchedFields((previous) => ({ ...previous, [fieldKey]: true }));
  const nextError = validateFieldValue(fieldKey, formValues[fieldKey] ?? "");
  setFieldErrors((previous) => ({ ...previous, [fieldKey]: nextError }));
};

const handleSubmit = (event: { preventDefault: () => void }): void => {
  event.preventDefault();
  const nextErrors = validateForm(formValues);
  setFieldErrors(nextErrors);
  setTouchedFields((previous) =>
    Object.keys(formValues).reduce<Record<string, boolean>>((nextTouched, fieldKey) => {
      nextTouched[fieldKey] = true;
      return nextTouched;
    }, { ...previous })
  );

  const hasErrors = Object.values(nextErrors).some((message) => message.length > 0);
  if (hasErrors) {
    return;
  }
};`
    : "";
  const accordionStateBlock = hasInteractiveAccordions
    ? `const [accordionState, setAccordionState] = useState<Record<string, boolean>>(${JSON.stringify(initialAccordionState, null, 2)});

const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
  setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
};`
    : "";
  const tabsStateBlock =
    renderContext.tabs.length > 0
      ? renderContext.tabs
          .map((tabModel) => {
            const tabValueVar = `tabValue${tabModel.stateId}`;
            const tabSetterVar = `setTabValue${tabModel.stateId}`;
            const tabChangeHandlerVar = `handleTabChange${tabModel.stateId}`;
            return `const [${tabValueVar}, ${tabSetterVar}] = useState<number>(0);

const ${tabChangeHandlerVar} = (_event: unknown, newValue: number): void => {
  ${tabSetterVar}(newValue);
};`;
          })
          .join("\n\n")
      : "";
  const dialogsStateBlock =
    renderContext.dialogs.length > 0
      ? renderContext.dialogs
          .map((dialogModel) => {
            const dialogOpenVar = `isDialogOpen${dialogModel.stateId}`;
            const dialogSetterVar = `setIsDialogOpen${dialogModel.stateId}`;
            const dialogCloseHandlerVar = `handleDialogClose${dialogModel.stateId}`;
            return `const [${dialogOpenVar}, ${dialogSetterVar}] = useState<boolean>(true);

const ${dialogCloseHandlerVar} = (): void => {
  ${dialogSetterVar}(false);
};`;
          })
          .join("\n\n")
      : "";
  const stateBlock = [submitButtonDeclaration, fieldStateBlock, accordionStateBlock, tabsStateBlock, dialogsStateBlock]
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
  const hasStatefulElements =
    hasInteractiveFields || hasInteractiveAccordions || renderContext.tabs.length > 0 || renderContext.dialogs.length > 0;
  const containerFormProps = hasInteractiveFields ? ' component="form" onSubmit={handleSubmit} noValidate' : "";

  const reactImport = hasStatefulElements ? 'import { useState } from "react";\n' : "";
  const routerImports: string[] = [];
  if (renderContext.usesRouterLink) {
    routerImports.push("Link as RouterLink");
  }
  if (renderContext.usesNavigateHandler) {
    routerImports.push("useNavigate");
  }
  const reactRouterImport =
    routerImports.length > 0 ? `import { ${routerImports.join(", ")} } from "react-router-dom";\n` : "";
  const navigationHookBlock = renderContext.usesNavigateHandler ? "const navigate = useNavigate();" : "";
  if (rendered.length === 0) {
    registerMuiImports(renderContext, "Typography");
  }
  const uniqueMuiImports = [...renderContext.muiImports].sort((left, right) => left.localeCompare(right));
  const iconImports = normalizeIconImports(renderContext.iconImports)
    .map((iconImport) => `import ${iconImport.localName} from "${iconImport.modulePath}";`)
    .join("\n");
  const mappedImports = renderContext.mappedImports
    .map((mappedImport) => `import ${mappedImport.localName} from "${mappedImport.modulePath}";`)
    .join("\n");

  return {
    file: {
      path: filePath,
      content: `${truncationComment}${reactImport}${reactRouterImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}

export default function ${componentName}Screen() {
${[navigationHookBlock, stateBlock]
  .filter((chunk) => chunk.length > 0)
  .map((chunk) => `${indentBlock(chunk, 2)}\n`)
  .join("")}
  return (
    <Container maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}
`
    },
    prototypeNavigationRenderedCount: renderContext.prototypeNavigationRenderedCount,
    usedMappingNodeIds: renderContext.usedMappingNodeIds,
    mappingWarnings: renderContext.mappingWarnings,
    accessibilityWarnings: renderContext.accessibilityWarnings
  };
};

export const toDeterministicScreenPath = (screenName: string): string => {
  return path.posix.join("src", "screens", ensureTsxName(screenName));
};

export const createDeterministicThemeFile = (ir: DesignIR): GeneratedFile => {
  return fallbackThemeFile(ir);
};

export const createDeterministicScreenFile = (
  screen: ScreenIR,
  options?: {
    routePathByScreenId?: Map<string, string> | Record<string, string>;
    generationLocale?: string;
  }
): GeneratedFile => {
  const routePathByScreenId =
    options?.routePathByScreenId instanceof Map
      ? options.routePathByScreenId
      : new Map(Object.entries(options?.routePathByScreenId ?? {}));
  return fallbackScreenFile({
    screen,
    mappingByNodeId: new Map<string, ComponentMappingRule>(),
    spacingBase: DEFAULT_SPACING_BASE,
    routePathByScreenId,
    ...(options?.generationLocale !== undefined ? { generationLocale: options.generationLocale } : {})
  }).file;
};

export const createDeterministicAppFile = (
  screens: ScreenIR[],
  options?: {
    routerMode?: WorkspaceRouterMode;
  }
): GeneratedFile => {
  const identitiesByScreenId = buildScreenArtifactIdentities(screens);
  return {
    path: "src/App.tsx",
    content: makeAppFile({
      screens,
      identitiesByScreenId,
      ...(options?.routerMode !== undefined ? { routerMode: options.routerMode } : {})
    })
  };
};

const makeAppFile = ({
  screens,
  identitiesByScreenId = buildScreenArtifactIdentities(screens),
  routerMode = DEFAULT_ROUTER_MODE
}: {
  screens: ScreenIR[];
  identitiesByScreenId?: Map<string, ScreenArtifactIdentity>;
  routerMode?: WorkspaceRouterMode;
}): string => {
  const lazyScreens = screens.slice(1);
  const hasLazyRoutes = lazyScreens.length > 0;
  const reactImport = hasLazyRoutes ? 'import { Suspense, lazy } from "react";' : 'import { Suspense } from "react";';
  const resolvedRouterMode: WorkspaceRouterMode = routerMode === "hash" ? "hash" : "browser";
  const routerComponentName = resolvedRouterMode === "hash" ? "HashRouter" : "BrowserRouter";
  const routerOpenTag = resolvedRouterMode === "hash" ? "<HashRouter>" : "<BrowserRouter basename={browserBasename}>";
  const routerCloseTag = resolvedRouterMode === "hash" ? "</HashRouter>" : "</BrowserRouter>";
  const browserBasenameBlock =
    resolvedRouterMode === "browser"
      ? `
const resolveBrowserBasename = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const reproMatch = window.location.pathname.match(/^\\/workspace\\/repros\\/[^/]+/);
  return reproMatch?.[0];
};

const browserBasename = resolveBrowserBasename();
`
      : "";

  const eagerImports = screens
    .slice(0, 1)
    .map((screen) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const fileName = (identity?.filePath ?? toDeterministicScreenPath(screen.name))
        .replace(/^src\/screens\//, "")
        .replace(/\.tsx$/i, "");
      return `import ${componentName}Screen from "./screens/${fileName}";`;
    })
    .join("\n");

  const lazyImports = lazyScreens
    .map((screen) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const fileName = (identity?.filePath ?? toDeterministicScreenPath(screen.name))
        .replace(/^src\/screens\//, "")
        .replace(/\.tsx$/i, "");
      return `const Lazy${componentName}Screen = lazy(async () => await import("./screens/${fileName}"));`;
    })
    .join("\n");

  const routes = screens
    .map((screen, index) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const routePath = identity?.routePath ?? `/${sanitizeFileName(screen.name).toLowerCase()}`;
      const routeComponent = index === 0 ? `${componentName}Screen` : `Lazy${componentName}Screen`;
      return `          <Route path="${routePath}" element={<${routeComponent} />} />`;
    })
    .join("\n");

  const firstScreen = screens.at(0);
  const firstIdentity = firstScreen ? identitiesByScreenId.get(firstScreen.id) : undefined;
  const firstRoute = firstIdentity?.routePath ?? (firstScreen ? `/${sanitizeFileName(firstScreen.name).toLowerCase()}` : "/");

  return `${reactImport}
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { ${routerComponentName}, Navigate, Route, Routes } from "react-router-dom";
${eagerImports}
${lazyImports.length > 0 ? `\n${lazyImports}` : ""}

const routeLoadingFallback = (
  <Box sx={{ display: "grid", minHeight: "50vh", placeItems: "center" }}>
    <CircularProgress size={32} />
  </Box>
);
${browserBasenameBlock}

function ThemeModeToggle() {
  const { mode, setMode, systemMode } = useColorScheme();
  const prefersDarkMode =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const resolvedMode =
    mode === "dark" || (mode !== "light" && (systemMode === "dark" || (systemMode === undefined && prefersDarkMode)))
      ? "dark"
      : "light";
  const nextMode = resolvedMode === "dark" ? "light" : "dark";
  const label = resolvedMode === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Box sx={{ position: "fixed", top: 16, right: 16, zIndex: 1301 }}>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          data-testid="theme-mode-toggle"
          onClick={() => setMode(nextMode)}
          sx={{
            bgcolor: "background.paper",
            color: "text.primary",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: 3,
            "&:hover": {
              bgcolor: "action.hover"
            }
          }}
        >
          {resolvedMode === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function App() {
  return (
    ${routerOpenTag}
      <ThemeModeToggle />
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
${routes}
          <Route path="/" element={<Navigate to="${firstRoute}" replace />} />
          <Route path="*" element={<Navigate to="${firstRoute}" replace />} />
        </Routes>
      </Suspense>
    ${routerCloseTag}
  );
}
`;
};

const writeGeneratedFile = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  if (!absolutePath.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error(`LLM attempted path traversal: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

const flattenElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const all: ScreenElementIR[] = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    all.push(current);
    for (const child of current.children ?? []) {
      stack.push(child);
    }
  }
  return all;
};

export const generateArtifacts = async ({
  projectDir,
  ir,
  componentMappings,
  iconMapFilePath = path.join(projectDir, ICON_FALLBACK_FILE_NAME),
  imageAssetMap = {},
  generationLocale,
  routerMode,
  llmModelName,
  llmCodegenMode,
  onLog
}: GenerateArtifactsInput): Promise<GenerateArtifactsResult> => {
  void llmModelName;
  if (llmCodegenMode !== "deterministic") {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: "Only deterministic code generation is supported in workspace-dev."
    });
  }

  const resolvedGenerationLocale = resolveGenerationLocale({
    requestedLocale: generationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  });
  if (resolvedGenerationLocale.usedFallback && typeof generationLocale === "string") {
    onLog(
      `Warning: Invalid generationLocale '${generationLocale}' configured for deterministic generation. ` +
        `Falling back to '${resolvedGenerationLocale.locale}'.`
    );
  }

  const generatedPaths = new Set<string>();
  const generationMetrics: GenerationMetrics = {
    fetchedNodes: ir.metrics?.fetchedNodes ?? 0,
    skippedHidden: ir.metrics?.skippedHidden ?? 0,
    skippedPlaceholders: ir.metrics?.skippedPlaceholders ?? 0,
    screenElementCounts: [...(ir.metrics?.screenElementCounts ?? [])],
    truncatedScreens: [...(ir.metrics?.truncatedScreens ?? [])],
    degradedGeometryNodes: [...(ir.metrics?.degradedGeometryNodes ?? [])],
    prototypeNavigationDetected: ir.metrics?.prototypeNavigationDetected ?? 0,
    prototypeNavigationResolved: ir.metrics?.prototypeNavigationResolved ?? 0,
    prototypeNavigationUnresolved: ir.metrics?.prototypeNavigationUnresolved ?? 0,
    prototypeNavigationRendered: 0
  };
  const truncationByScreenId = new Map(
    generationMetrics.truncatedScreens.map((entry) => [entry.screenId, entry] as const)
  );

  const allIrNodeIds = new Set<string>(
    ir.screens.flatMap((screen) => flattenElements(screen.children).map((node) => node.id))
  );
  const prioritizedMappings = [...(componentMappings ?? [])]
    .filter((mapping) => mapping.nodeId.trim().length > 0)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "local_override" ? -1 : 1;
      }
      return left.nodeId.localeCompare(right.nodeId);
    });
  const mappingByNodeId = new Map<string, ComponentMappingRule>();
  for (const mapping of prioritizedMappings) {
    if (!mappingByNodeId.has(mapping.nodeId)) {
      mappingByNodeId.set(mapping.nodeId, mapping);
    }
  }
  const mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }> = [];
  for (const [nodeId] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Mapping for node '${nodeId}' has no matching node in current IR`
      });
    }
  }

  await mkdir(path.join(projectDir, "src", "screens"), { recursive: true });
  await mkdir(path.join(projectDir, "src", "theme"), { recursive: true });

  const iconResolver = await loadIconFallbackResolver({
    iconMapFilePath,
    onLog
  });

  const tokensPath = path.join(projectDir, "src", "theme", "tokens.json");
  await writeFile(tokensPath, JSON.stringify(ir.tokens, null, 2), "utf-8");
  generatedPaths.add("src/theme/tokens.json");

  const deterministicTheme = fallbackThemeFile(ir);
  await writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);

  const identitiesByScreenId = buildScreenArtifactIdentities(ir.screens);
  const routePathByScreenId = new Map(
    Array.from(identitiesByScreenId.entries()).map(([screenId, identity]) => [screenId, identity.routePath] as const)
  );
  const usedMappingNodeIds = new Set<string>();
  const accessibilityWarnings: AccessibilityWarning[] = [];
  let prototypeNavigationRenderedCount = 0;
  const deterministicScreens = ir.screens.map((screen) => {
    const identity = identitiesByScreenId.get(screen.id);
    const truncationMetric = truncationByScreenId.get(screen.id);
    if (truncationMetric) {
      onLog(
        `Screen '${screen.name}' truncated from ${truncationMetric.originalElements} to ${truncationMetric.retainedElements} elements (budget=${truncationMetric.budget}).`
      );
    }
    const deterministicScreen = fallbackScreenFile({
      screen,
      mappingByNodeId,
      spacingBase: ir.tokens.spacingBase,
      tokens: ir.tokens,
      iconResolver,
      imageAssetMap,
      routePathByScreenId,
      generationLocale: resolvedGenerationLocale.locale,
      ...(identity?.componentName ? { componentNameOverride: identity.componentName } : {}),
      ...(identity?.filePath ? { filePathOverride: identity.filePath } : {}),
      ...(truncationMetric ? { truncationMetric } : {})
    });
    prototypeNavigationRenderedCount += deterministicScreen.prototypeNavigationRenderedCount;
    for (const nodeId of deterministicScreen.usedMappingNodeIds.values()) {
      usedMappingNodeIds.add(nodeId);
    }
    for (const warning of deterministicScreen.mappingWarnings) {
      mappingWarnings.push({
        code: warning.code,
        message: warning.message
      });
    }
    accessibilityWarnings.push(...deterministicScreen.accessibilityWarnings);

    return {
      file: deterministicScreen.file
    };
  });
  await Promise.all(
    deterministicScreens.map(async (item) => {
      await writeGeneratedFile(projectDir, item.file);
      generatedPaths.add(item.file.path);
    })
  );

  for (const [nodeId, mapping] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      continue;
    }
    if (!mapping.enabled) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_DISABLED",
        message: `Component mapping disabled for node '${nodeId}', deterministic fallback used`
      });
      continue;
    }
    if (!mapping.componentName.trim() || !mapping.importPath.trim()) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping for node '${nodeId}' is missing componentName/importPath, deterministic fallback used`
      });
      continue;
    }
    if (mapping.propContract !== undefined && !isPlainRecord(mapping.propContract)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping contract for node '${nodeId}' is not an object, deterministic fallback used`
      });
      continue;
    }
    if (!usedMappingNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Component mapping for node '${nodeId}' was not applied; deterministic fallback used`
      });
    }
  }

  await writeFile(
    path.join(projectDir, "src", "App.tsx"),
    makeAppFile({
      screens: ir.screens,
      identitiesByScreenId,
      ...(routerMode !== undefined ? { routerMode } : {})
    }),
    "utf-8"
  );
  generatedPaths.add("src/App.tsx");

  const generationMetricsPath = path.join(projectDir, "generation-metrics.json");
  generationMetrics.prototypeNavigationRendered = prototypeNavigationRenderedCount;
  const generationMetricsPayload = {
    ...generationMetrics,
    accessibilityWarnings
  };
  await writeFile(generationMetricsPath, `${JSON.stringify(generationMetricsPayload, null, 2)}\n`, "utf-8");
  generatedPaths.add("generation-metrics.json");

  if (generationMetrics.degradedGeometryNodes.length > 0) {
    onLog(`Geometry degraded for ${generationMetrics.degradedGeometryNodes.length} node(s) during staged fetch.`);
  }
  if ((generationMetrics.prototypeNavigationDetected ?? 0) > 0 || (generationMetrics.prototypeNavigationRendered ?? 0) > 0) {
    onLog(
      `Prototype navigation: detected=${generationMetrics.prototypeNavigationDetected ?? 0}, resolved=${
        generationMetrics.prototypeNavigationResolved ?? 0
      }, unresolved=${generationMetrics.prototypeNavigationUnresolved ?? 0}, rendered=${generationMetrics.prototypeNavigationRendered ?? 0}`
    );
  }
  if ((generationMetrics.prototypeNavigationUnresolved ?? 0) > 0) {
    onLog(
      `Warning: ${generationMetrics.prototypeNavigationUnresolved} prototype navigation target(s) were unresolved and ignored.`
    );
  }
  if (accessibilityWarnings.length > 0) {
    for (const warning of accessibilityWarnings) {
      onLog(`[a11y] ${warning.message}`);
    }
    onLog(`Accessibility warnings: ${accessibilityWarnings.length} potential contrast issue(s).`);
  }

  onLog("Generated deterministic baseline artifacts");

  const themeApplied = false;
  const screenApplied = 0;
  const screenRejected: RejectedScreenEnhancement[] = [];
  const llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }> = [];
  const screenTotal = deterministicScreens.length;
  const mappingCoverage = {
    usedMappings: usedMappingNodeIds.size,
    fallbackNodes: Math.max(0, mappingByNodeId.size - usedMappingNodeIds.size),
    totalCandidateNodes: mappingByNodeId.size
  };
  const dedupedMappingWarnings = dedupeMappingWarnings(mappingWarnings);
  const mappingDiagnostics = {
    missingMappingCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_MISSING").length,
    contractMismatchCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_CONTRACT_MISMATCH").length,
    disabledMappingCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_DISABLED").length
  };
  onLog("LLM enhancement disabled in deterministic mode; deterministic output retained");
  return {
    generatedPaths: Array.from(generatedPaths),
    generationMetrics,
    themeApplied,
    screenApplied,
    screenTotal,
    screenRejected,
    llmWarnings,
    mappingCoverage,
    mappingDiagnostics,
    mappingWarnings: dedupedMappingWarnings
  };
};
