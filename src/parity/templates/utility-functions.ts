// ---------------------------------------------------------------------------
// utility-functions.ts — Shared helpers: spacing, colors, fonts, sx, text
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import {
  isTextElement
} from "../types.js";
import type {
  TextElementIR,
  DesignIR,
  DesignTokens,
  ScreenElementIR,
  ResponsiveBreakpoint,
  VariantStateStyle
} from "../types.js";
import { isRtlLocale } from "../generator-render.js";
import { WCAG_AA_NORMAL_TEXT_CONTRAST_MIN } from "../constants.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../../contracts/index.js";
import {
  toPercentLiteralFromRatio,
  RESPONSIVE_BREAKPOINT_ORDER,
  MUI_DEFAULT_BREAKPOINT_VALUES,
  toSxValueMapFromEntries,
  toResponsiveLayoutMediaEntries
} from "../generator-responsive.js";
import type {
  RenderContext,
  VirtualParent,
  RgbaColor,
  ButtonVariant,
  ButtonSize,
  ResolvedFormHandlingMode
} from "../generator-core.js";

export const literal = (value: string): string => JSON.stringify(value);

export const toPascalCase = (value: string): string => {
  return value.replace(/(?:^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const normalizeOpacityForSx = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = clamp(value, 0, 1);
  return normalized < 1 ? normalized : undefined;
};

export const normalizeFontFamily = (rawFamily: string | undefined): string | undefined => {
  if (!rawFamily || !rawFamily.trim()) {
    return undefined;
  }
  const normalized = rawFamily.trim();
  if (/roboto|arial|sans-serif/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}, Roboto, Arial, sans-serif`;
};


export const toPxLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return literal(`${Math.round(value)}px`);
};

export const DEFAULT_SPACING_BASE = 8;
export const REM_BASE = 16;
export const DEFAULT_ROUTER_MODE: WorkspaceRouterMode = "browser";

export const normalizeSpacingBase = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SPACING_BASE;
  }
  return value;
};

export const toSpacingUnitValue = ({
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

export const toSpacingEdgeUnit = ({
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

export const toBoxSpacingSxEntries = ({
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

export const toThemeBorderRadiusValue = ({
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

export const toRemLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rem = Math.round((value / REM_BASE) * 10000) / 10000;
  const remString = Number.isInteger(rem) ? String(rem) : rem.toString();
  return literal(`${remString}rem`);
};

export const toEmLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const em = Math.round(value * 10000) / 10000;
  const emString = Number.isInteger(em) ? String(em) : em.toString();
  return literal(`${emString}em`);
};

export const toLetterSpacingEm = ({
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

export const normalizeHexColor = (value: string | undefined): string | undefined => {
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

export const toRoundedIntegerInRange = ({
  value,
  min,
  max
}: {
  value: number | undefined;
  min: number;
  max: number;
}): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    return undefined;
  }
  return rounded;
};

export const resolveDeterministicIntegerSample = ({
  values,
  min,
  max
}: {
  values: Array<number | undefined>;
  min: number;
  max: number;
}): number | undefined => {
  const normalized = values
    .map((value) =>
      toRoundedIntegerInRange({
        value,
        min,
        max
      })
    )
    .filter((value): value is number => typeof value === "number");
  if (normalized.length === 0) {
    return undefined;
  }
  const sorted = [...normalized].sort((left, right) => left - right);
  const centerIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? Math.round(((sorted[centerIndex - 1] ?? sorted[0] ?? 0) + (sorted[centerIndex] ?? sorted[0] ?? 0)) / 2)
      : (sorted[centerIndex] ?? sorted[0] ?? 0);
  const counts = new Map<number, number>();
  for (const value of sorted) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const modeCandidates = Array.from(counts.entries())
    .filter(([, count]) => count === maxCount)
    .map(([value]) => value)
    .sort((left, right) => Math.abs(left - median) - Math.abs(right - median) || left - right);
  return modeCandidates[0];
};

export const resolveDeterministicColorSample = (values: Array<string | undefined>): string | undefined => {
  const normalized = values.map((value) => normalizeHexColor(value)).filter((value): value is string => typeof value === "string");
  if (normalized.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const value of normalized) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  const candidates = Array.from(counts.entries())
    .filter(([, count]) => count === maxCount)
    .map(([value]) => value)
    .sort((left, right) => left.localeCompare(right));
  return candidates[0];
};

export const withOmittedSxKeys = ({
  entries,
  keys
}: {
  entries: Array<[string, string | number | undefined]>;
  keys: Set<string>;
}): Array<[string, string | number | undefined]> => {
  if (keys.size === 0) {
    return entries;
  }
  return entries.map(([key, value]) => {
    if (keys.has(key)) {
      return [key, undefined] as [string, string | number | undefined];
    }
    return [key, value] as [string, string | number | undefined];
  });
};

export const toThemePaletteLiteral = ({
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

export const toThemeColorLiteral = ({
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


export const BUTTON_FULL_WIDTH_EPSILON = 0.02;
export const BUTTON_VISIBLE_ALPHA_THRESHOLD = 0.08;
export const BUTTON_DISABLED_OPACITY_THRESHOLD = 0.55;
export const BUTTON_NEUTRAL_CHANNEL_DELTA_MAX = 24;
export const BUTTON_NEAR_WHITE_MIN_CHANNEL = 245;
export const FIELD_ERROR_RED_MIN_CHANNEL = 150;
export const FIELD_ERROR_RED_DELTA_MIN = 32;
export { WCAG_AA_NORMAL_TEXT_CONTRAST_MIN } from "../constants.js";
export const DARK_MODE_BACKGROUND_DEFAULT = "#121212";
export const DARK_MODE_BACKGROUND_PAPER = "#1e1e1e";
export const DARK_MODE_TEXT_PRIMARY = "#f5f7fb";
export const LIGHTEN_TO_WHITE_STEP = 0.08;
export const LIGHTEN_TO_WHITE_MAX_STEPS = 11;
export const DEFAULT_FORM_HANDLING_MODE: ResolvedFormHandlingMode = "react_hook_form";


export const resolveFormHandlingMode = ({
  requestedMode
}: {
  requestedMode: WorkspaceFormHandlingMode | undefined;
}): ResolvedFormHandlingMode => {
  return requestedMode === "legacy_use_state" ? "legacy_use_state" : DEFAULT_FORM_HANDLING_MODE;
};

export const hasVisibleGradient = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
};

export const toRgbaColor = (value: string | undefined): RgbaColor | undefined => {
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

export const isVisibleColor = (color: RgbaColor | undefined, minAlpha: number = BUTTON_VISIBLE_ALPHA_THRESHOLD): boolean => {
  if (!color) {
    return false;
  }
  return color.a >= minAlpha;
};

export const isNearWhiteColor = (color: RgbaColor | undefined): boolean => {
  if (!isVisibleColor(color)) {
    return false;
  }
  if (!color) {
    return false;
  }
  const channelDelta = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  return channelDelta <= BUTTON_NEUTRAL_CHANNEL_DELTA_MAX && color.r >= BUTTON_NEAR_WHITE_MIN_CHANNEL && color.g >= BUTTON_NEAR_WHITE_MIN_CHANNEL && color.b >= BUTTON_NEAR_WHITE_MIN_CHANNEL;
};

export const isNeutralGrayColor = (color: RgbaColor | undefined): boolean => {
  if (!isVisibleColor(color, 0.2)) {
    return false;
  }
  if (!color) {
    return false;
  }
  const channelDelta = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  return channelDelta <= BUTTON_NEUTRAL_CHANNEL_DELTA_MAX;
};

export const isLikelyErrorRedColor = (color: RgbaColor | undefined): boolean => {
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

export const toRelativeLuminance = (color: RgbaColor): number => {
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

export const toContrastRatio = (foreground: RgbaColor, background: RgbaColor): number => {
  const foregroundLuminance = toRelativeLuminance(foreground);
  const backgroundLuminance = toRelativeLuminance(background);
  const brighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (brighter + 0.05) / (darker + 0.05);
};

export const toOpaqueHex = (value: string | undefined): string | undefined => {
  const normalized = normalizeHexColor(value);
  if (!normalized) {
    return undefined;
  }
  return `#${normalized.slice(1, 7)}`;
};

export const toHexChannel = (value: number): string => {
  return clamp(Math.round(value), 0, 255)
    .toString(16)
    .padStart(2, "0");
};

export const toRgbHex = (color: { r: number; g: number; b: number }): string => {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
};

export const mixHexColors = ({
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

export const toHexWithAlpha = (hex: string, alpha: number): string => {
  const normalized = toOpaqueHex(hex);
  if (!normalized) {
    return hex;
  }
  const alphaHex = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `${normalized}${alphaHex}`;
};

export const ensureContrastAgainstBackground = ({
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

export const buildActionPalette = ({
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

export interface ResolvedThemePalette {
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

export const toLightThemePalette = (tokens: DesignTokens): ResolvedThemePalette => {
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

export const toDarkThemePalette = (
  tokens: DesignTokens,
  darkPaletteHints?: NonNullable<DesignIR["themeAnalysis"]>["darkPaletteHints"]
): ResolvedThemePalette => {
  const darkBackgroundDefault = darkPaletteHints?.background?.default ?? DARK_MODE_BACKGROUND_DEFAULT;
  const darkBackgroundPaper = darkPaletteHints?.background?.paper ?? DARK_MODE_BACKGROUND_PAPER;
  const darkTextPrimary = ensureContrastAgainstBackground({
    color: darkPaletteHints?.text?.primary ?? DARK_MODE_TEXT_PRIMARY,
    background: darkBackgroundDefault
  });
  const adjustedPrimary = ensureContrastAgainstBackground({
    color: darkPaletteHints?.primary ?? tokens.palette.primary,
    background: darkBackgroundDefault
  });
  const adjustedSecondary = ensureContrastAgainstBackground({
    color: darkPaletteHints?.secondary ?? tokens.palette.secondary,
    background: darkBackgroundDefault
  });
  const adjustedSuccess = ensureContrastAgainstBackground({
    color: darkPaletteHints?.success ?? tokens.palette.success,
    background: darkBackgroundDefault
  });
  const adjustedWarning = ensureContrastAgainstBackground({
    color: darkPaletteHints?.warning ?? tokens.palette.warning,
    background: darkBackgroundDefault
  });
  const adjustedError = ensureContrastAgainstBackground({
    color: darkPaletteHints?.error ?? tokens.palette.error,
    background: darkBackgroundDefault
  });
  const adjustedInfo = ensureContrastAgainstBackground({
    color: darkPaletteHints?.info ?? tokens.palette.info,
    background: darkBackgroundDefault
  });

  return {
    primary: adjustedPrimary,
    secondary: adjustedSecondary,
    success: adjustedSuccess,
    warning: adjustedWarning,
    error: adjustedError,
    info: adjustedInfo,
    background: {
      default: darkBackgroundDefault,
      paper: darkBackgroundPaper
    },
    text: {
      primary: darkTextPrimary
    },
    divider: darkPaletteHints?.divider ?? toHexWithAlpha(darkTextPrimary, 0.12),
    action: buildActionPalette({
      primaryColor: adjustedPrimary,
      textColor: darkTextPrimary
    })
  };
};

export const toThemePaletteBlock = ({
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


export const inferButtonVariant = ({
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

export const inferButtonSize = ({
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

export const inferButtonFullWidth = ({
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

export const inferButtonDisabled = ({
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

export const filterButtonVariantEntries = ({
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

export const mapPrimaryAxisAlignToJustifyContent = (
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

export const mapCounterAxisAlignToAlignItems = (
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


export const dedupeSxEntries = (entries: Array<[string, string | number | undefined]>): Array<[string, string | number]> => {
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
  return deduped;
};

export const sxString = (entries: Array<[string, string | number | undefined]>): string => {
  return dedupeSxEntries(entries).map(([key, value]) => `${key}: ${typeof value === "number" ? value : value}`).join(", ");
};


export const toPaintSxEntries = ({
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

export const normalizeElevationForSx = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return clamp(Math.round(value), 0, 24);
};

export const matchesRoundedInteger = ({
  value,
  target
}: {
  value: number | undefined;
  target: number | undefined;
}): boolean => {
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return false;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  return Math.round(value) === target;
};

export const toShadowSxEntry = ({
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

export const toVariantStateSxObject = ({
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

export const appendVariantStateOverridesToSx = ({
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

export const toChipVariant = (value: "contained" | "outlined" | "text" | undefined): "filled" | "outlined" | undefined => {
  if (!value) {
    return undefined;
  }
  if (value === "outlined") {
    return "outlined";
  }
  return "filled";
};

export const toChipSize = (value: "small" | "medium" | "large" | undefined): "small" | "medium" | undefined => {
  if (value === "small") {
    return "small";
  }
  if (value === "medium" || value === "large") {
    return "medium";
  }
  return undefined;
};

export const inferChipSizeFromHeight = (height: number | undefined): "small" | "medium" | undefined => {
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  return height <= 28 ? "small" : "medium";
};

export const indentBlock = (value: string, spaces: number): string => {
  const indent = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join("\n");
};

export const baseLayoutEntries = (
  element: ScreenElementIR,
  parent: VirtualParent,
  options?: {
    includePaints?: boolean;
    preferInsetShadow?: boolean;
    spacingBase?: number;
    tokens?: DesignTokens | undefined;
    generationLocale?: string;
  }
): Array<[string, string | number | undefined]> => {
  const includePaints = options?.includePaints ?? true;
  const preferInsetShadow = options?.preferInsetShadow ?? true;
  const spacingBase = normalizeSpacingBase(options?.spacingBase);
  const tokens = options?.tokens;
  const rtl = isRtlLocale(options?.generationLocale);
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
    [rtl ? "insetInlineStart" : "left", isAbsoluteChild ? toPxLiteral((element.x ?? 0) - (parent.x ?? 0)) : undefined],
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
      rightKey: rtl ? "paddingInlineEnd" : "pr",
      bottomKey: "pb",
      leftKey: rtl ? "paddingInlineStart" : "pl"
    }),
    ...toBoxSpacingSxEntries({
      values: element.margin,
      spacingBase,
      allKey: "m",
      xKey: "mx",
      yKey: "my",
      topKey: "mt",
      rightKey: rtl ? "marginInlineEnd" : "mr",
      bottomKey: "mb",
      leftKey: rtl ? "marginInlineStart" : "ml"
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

export const toElementSx = ({
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
  const baseEntries = baseLayoutEntries(element, parent, {
    includePaints,
    preferInsetShadow,
    spacingBase: context.spacingBase,
    tokens: context.tokens,
    generationLocale: context.generationLocale
  });
  const responsiveEntries = toResponsiveLayoutMediaEntries({
    baseLayoutMode: element.layoutMode ?? "NONE",
    overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
    spacingBase: context.spacingBase,
    baseValuesByKey: toSxValueMapFromEntries(baseEntries)
  });
  return sxString([
    ...baseEntries,
    ...responsiveEntries
  ]);
};

export const firstText = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
  if (visited.has(element)) {
    return undefined;
  }
  visited.add(element);
  if (isTextElement(element) && element.text.trim()) {
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

export const firstTextColor = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
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

export const collectVectorPaths = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
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

export const firstVectorColor = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
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

export const collectTextNodes = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): TextElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const local = isTextElement(element) && element.text.trim() ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectTextNodes(child, visited));
  return [...local, ...nested];
};


export const escapeXmlText = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

export const toRenderableAssetSource = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/images/")) {
    return trimmed;
  }
  return `.${trimmed}`;
};

export const sanitizeSelectOptionValue = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Option";
};

export const deriveResponsiveThemeBreakpointValues = (ir: DesignIR): Record<ResponsiveBreakpoint, number> | undefined => {
  const widthsByBreakpoint: Record<ResponsiveBreakpoint, Array<number | undefined>> = {
    xs: [],
    sm: [],
    md: [],
    lg: [],
    xl: []
  };
  for (const screen of ir.screens) {
    if (!screen.responsive) {
      continue;
    }
    for (const variant of screen.responsive.variants) {
      widthsByBreakpoint[variant.breakpoint].push(variant.width);
    }
  }

  const representativeWidthByBreakpoint: Partial<Record<ResponsiveBreakpoint, number>> = {};
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const representativeWidth = resolveDeterministicIntegerSample({
      values: widthsByBreakpoint[breakpoint],
      min: 1,
      max: 20_000
    });
    if (representativeWidth !== undefined) {
      representativeWidthByBreakpoint[breakpoint] = representativeWidth;
    }
  }

  const values: Record<ResponsiveBreakpoint, number> = {
    ...MUI_DEFAULT_BREAKPOINT_VALUES
  };
  for (let index = 1; index < RESPONSIVE_BREAKPOINT_ORDER.length; index += 1) {
    const current = RESPONSIVE_BREAKPOINT_ORDER[index] as ResponsiveBreakpoint;
    const previous = RESPONSIVE_BREAKPOINT_ORDER[index - 1] as ResponsiveBreakpoint;
    const previousRepresentative = representativeWidthByBreakpoint[previous];
    const currentRepresentative = representativeWidthByBreakpoint[current];
    if (previousRepresentative === undefined && currentRepresentative === undefined) {
      continue;
    }
    const lower = previousRepresentative ?? MUI_DEFAULT_BREAKPOINT_VALUES[previous];
    const upper = currentRepresentative ?? MUI_DEFAULT_BREAKPOINT_VALUES[current];
    const midpoint = Math.round((lower + upper) / 2);
    values[current] = Math.max(values[previous] + 1, midpoint);
  }

  const hasCustomValue = RESPONSIVE_BREAKPOINT_ORDER.some((breakpoint) => {
    return values[breakpoint] !== MUI_DEFAULT_BREAKPOINT_VALUES[breakpoint];
  });
  return hasCustomValue ? values : undefined;
};

export const toMuiContainerMaxWidth = (contentWidth: number): "sm" | "md" | "lg" | "xl" => {
  if (contentWidth <= MUI_DEFAULT_BREAKPOINT_VALUES.sm) {
    return "sm";
  }
  if (contentWidth <= MUI_DEFAULT_BREAKPOINT_VALUES.md) {
    return "md";
  }
  if (contentWidth <= MUI_DEFAULT_BREAKPOINT_VALUES.lg) {
    return "lg";
  }
  if (contentWidth <= MUI_DEFAULT_BREAKPOINT_VALUES.xl) {
    return "xl";
  }
  return "xl";
};

export const toAlertSeverityFromName = (name: string): "error" | "warning" | "info" | "success" => {
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

