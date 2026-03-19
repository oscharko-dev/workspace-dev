import path from "node:path";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignIR,
  DesignTokenTypographyVariantName,
  GeneratedFile,
  ResponsiveBreakpoint,
  ScreenResponsiveLayoutOverride,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  SimplificationMetrics,
  ScreenElementIR,
  ScreenIR,
  VariantStateStyle
} from "./types.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import {
  registerMuiImports,
  registerIconImport,
  registerInteractiveField,
  registerInteractiveAccordion,
  buildSemanticInputModel,
  resolvePrototypeNavigationBinding,
  toRouterLinkProps,
  toNavigateHandlerProps,
  resolveBackgroundHexForText,
  pushLowContrastWarning,
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  hasMeaningfulTextDescendants,
  inferLandmarkRole,
  isDecorativeElement,
  isDecorativeImageElement,
  inferHeadingComponentByNodeId,
  resolveTypographyVariantByNodeId,
  resolveImageSource,
  pickBestIconNode,
  resolveFallbackIconComponent,
  normalizeIconImports,
  sortChildren,
  isLikelyInputContainer,
  isLikelyAccordionContainer,
  isIconLikeNode,
  isSemanticIconWrapper,
  hasVisualStyle,
  detectTabInterfacePattern,
  detectDialogOverlayPattern,
  detectNavigationBarPattern,
  detectGridLikeContainerLayout,
  detectRepeatedListPattern,
  ensureTabsStateModel,
  ensureDialogStateModel,
  collectListRows,
  analyzeListRow,
  isRenderableTabAction,
  deriveSelectOptions,
  renderMappedElement,
  toStateKey,
  approximatelyEqualNumber,
  inferRequiredFromLabel,
  sanitizeRequiredLabel,
  inferVisualErrorFromOutline,
  toListSecondaryActionExpression,
  findFirstByName,
  toFormContextProviderName,
  toFormContextHookName,
  extractSharedSxConstantsFromScreenContent,
  resolveIconColor,
  toComponentName,
  buildScreenArtifactIdentities,
  ICON_FALLBACK_BUILTIN_RESOLVER,
  buildPatternExtractionPlan,
  createEmptySimplificationStats,
  simplifyElements,
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey,
  collectThemeSxSampleFromEntries,
  collectThemeDefaultMatchedSxKeys,
  toDeterministicScreenPath
} from "./generator-core.js";
import type {
  RenderContext,
  VirtualParent,
  AccessibilityWarning,
  RgbaColor,
  ButtonVariant,
  ButtonSize,
  ValidationFieldType,
  ResolvedFormHandlingMode,
  HeadingComponent,
  SemanticIconModel,
  InteractiveFieldModel,
  IconFallbackResolver,
  PatternContextFileSpec,
  FormContextFileSpec,
  PatternExtractionPlan,
  RenderedButtonModel,
  ThemeComponentDefaults,
  ThemeSxStyleValue,
  ScreenArtifactIdentity,
  ListRowAnalysis
} from "./generator-core.js";

export const literal = (value: string): string => JSON.stringify(value);

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

export const RESPONSIVE_WIDTH_RATIO_MIN = 0.001;
export const RESPONSIVE_WIDTH_RATIO_MAX = 1.2;
export const RESPONSIVE_FULL_WIDTH_EPSILON = 0.02;

export const normalizeResponsiveWidthRatio = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const normalized = clamp(value, RESPONSIVE_WIDTH_RATIO_MIN, RESPONSIVE_WIDTH_RATIO_MAX);
  return Math.round(normalized * 1000) / 1000;
};

export const toPercentLiteralFromRatio = (ratio: number | undefined): string | undefined => {
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
export const WCAG_AA_NORMAL_TEXT_CONTRAST_MIN = 4.5;
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

export const toDarkThemePalette = (tokens: DesignTokens): ResolvedThemePalette => {
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

export const RESPONSIVE_BREAKPOINT_ORDER: ResponsiveBreakpoint[] = ["xs", "sm", "md", "lg", "xl"];
export const MUI_DEFAULT_BREAKPOINT_VALUES: Record<ResponsiveBreakpoint, number> = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536
};

export const RESPONSIVE_FALLBACK_RESET_VALUE_BY_PROPERTY: Record<string, string> = {
  maxWidth: literal("none"),
  width: literal("auto"),
  minHeight: literal("auto"),
  display: literal("initial"),
  flexDirection: literal("initial"),
  justifyContent: literal("initial"),
  alignItems: literal("initial"),
  gap: literal("initial")
};

export type ResponsiveSxValue = string | number | undefined;
export type ResponsiveSxEntry = [string, ResponsiveSxValue];

export const toResponsiveSxValueLiteral = (value: string | number): string => {
  return typeof value === "number" ? `${value}` : value;
};

export const hasSameResponsiveSxValue = (left: ResponsiveSxValue, right: ResponsiveSxValue): boolean => {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  return left === right;
};

export const toSxValueMapFromEntries = (entries: ResponsiveSxEntry[]): Map<string, string | number> => {
  const valueByKey = new Map<string, string | number>();
  for (const [key, value] of dedupeSxEntries(entries)) {
    valueByKey.set(key, value);
  }
  return valueByKey;
};

export const pushResponsiveStyleEntry = ({
  byBreakpoint,
  breakpoint,
  entry
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
  breakpoint: ResponsiveBreakpoint;
  entry: ResponsiveSxEntry;
}): void => {
  const current = byBreakpoint.get(breakpoint) ?? [];
  current.push(entry);
  byBreakpoint.set(breakpoint, current);
};

export const appendLayoutOverrideEntriesForBreakpoint = ({
  byBreakpoint,
  breakpoint,
  baseLayoutMode,
  override,
  spacingBase
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
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

export const toResponsivePropertyValueByBreakpoint = (
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>
): Map<string, Map<ResponsiveBreakpoint, string | number>> => {
  const valuesByProperty = new Map<string, Map<ResponsiveBreakpoint, string | number>>();
  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const styleEntries = byBreakpoint.get(breakpoint);
    if (!styleEntries || styleEntries.length === 0) {
      continue;
    }
    for (const [property, value] of dedupeSxEntries(styleEntries)) {
      const byBreakpointValues = valuesByProperty.get(property) ?? new Map<ResponsiveBreakpoint, string | number>();
      byBreakpointValues.set(breakpoint, value);
      valuesByProperty.set(property, byBreakpointValues);
    }
  }
  return valuesByProperty;
};

export const toResponsiveObjectLiteralForProperty = ({
  property,
  overrideValuesByBreakpoint,
  baseValue
}: {
  property: string;
  overrideValuesByBreakpoint: Map<ResponsiveBreakpoint, string | number>;
  baseValue: string | number | undefined;
}): string | undefined => {
  const stepEntries: string[] = [];
  const resetValue = baseValue === undefined ? RESPONSIVE_FALLBACK_RESET_VALUE_BY_PROPERTY[property] : undefined;
  let previousEffective: ResponsiveSxValue = baseValue;

  for (const breakpoint of RESPONSIVE_BREAKPOINT_ORDER) {
    const overrideValue = overrideValuesByBreakpoint.get(breakpoint);
    const effectiveValue = overrideValue !== undefined ? overrideValue : baseValue;
    if (hasSameResponsiveSxValue(effectiveValue, previousEffective)) {
      continue;
    }
    if (effectiveValue !== undefined) {
      stepEntries.push(`${breakpoint}: ${toResponsiveSxValueLiteral(effectiveValue)}`);
      previousEffective = effectiveValue;
      continue;
    }
    if (resetValue !== undefined) {
      stepEntries.push(`${breakpoint}: ${resetValue}`);
    }
    previousEffective = effectiveValue;
  }

  if (stepEntries.length === 0) {
    return undefined;
  }
  return `{ ${stepEntries.join(", ")} }`;
};

export const toResponsiveObjectEntries = ({
  byBreakpoint,
  baseValuesByKey
}: {
  byBreakpoint: Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>;
  baseValuesByKey: Map<string, string | number>;
}): ResponsiveSxEntry[] => {
  const entries: ResponsiveSxEntry[] = [];
  for (const [property, overrideValuesByBreakpoint] of toResponsivePropertyValueByBreakpoint(byBreakpoint).entries()) {
    const responsiveObjectLiteral = toResponsiveObjectLiteralForProperty({
      property,
      overrideValuesByBreakpoint,
      baseValue: baseValuesByKey.get(property)
    });
    if (!responsiveObjectLiteral) {
      continue;
    }
    entries.push([property, responsiveObjectLiteral]);
  }
  return entries;
};

export const toResponsiveLayoutMediaEntries = ({
  baseLayoutMode,
  overrides,
  spacingBase,
  baseValuesByKey = new Map<string, string | number>()
}: {
  baseLayoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  overrides: ScreenResponsiveLayoutOverridesByBreakpoint | undefined;
  spacingBase: number;
  baseValuesByKey?: Map<string, string | number>;
}): ResponsiveSxEntry[] => {
  if (!overrides) {
    return [];
  }
  const byBreakpoint = new Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>();
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
  return toResponsiveObjectEntries({
    byBreakpoint,
    baseValuesByKey
  });
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
    tokens: context.tokens
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

export const toResponsiveBaseLayoutValues = ({
  layoutMode,
  gap,
  primaryAxisAlignItems,
  counterAxisAlignItems,
  spacingBase
}: {
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  gap: number;
  primaryAxisAlignItems?: ScreenResponsiveLayoutOverride["primaryAxisAlignItems"];
  counterAxisAlignItems?: ScreenResponsiveLayoutOverride["counterAxisAlignItems"];
  spacingBase: number;
}): Map<string, string | number> => {
  const entries: ResponsiveSxEntry[] = [];
  if (layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL") {
    entries.push(["display", literal("flex")]);
    entries.push(["flexDirection", literal(layoutMode === "HORIZONTAL" ? "row" : "column")]);
    const justifyContent = mapPrimaryAxisAlignToJustifyContent(primaryAxisAlignItems);
    if (justifyContent) {
      entries.push(["justifyContent", literal(justifyContent)]);
    }
    const alignItems = mapCounterAxisAlignToAlignItems(counterAxisAlignItems, layoutMode);
    if (alignItems) {
      entries.push(["alignItems", literal(alignItems)]);
    }
  }
  if (typeof gap === "number" && Number.isFinite(gap) && gap > 0) {
    entries.push(["gap", toSpacingUnitValue({ value: gap, spacingBase })]);
  }
  return toSxValueMapFromEntries(entries);
};

export const toScreenResponsiveRootMediaEntries = ({
  screen,
  spacingBase
}: {
  screen: ScreenIR;
  spacingBase: number;
}): Array<[string, string | number | undefined]> => {
  if (!screen.responsive) {
    return [];
  }

  const byBreakpoint = new Map<ResponsiveBreakpoint, ResponsiveSxEntry[]>();

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

  const baseValuesByKey = toResponsiveBaseLayoutValues({
    layoutMode: screen.layoutMode,
    gap: screen.gap,
    primaryAxisAlignItems: screen.primaryAxisAlignItems,
    counterAxisAlignItems: screen.counterAxisAlignItems,
    spacingBase
  });
  baseValuesByKey.set("maxWidth", literal("none"));

  return toResponsiveObjectEntries({
    byBreakpoint,
    baseValuesByKey
  });
};

export const renderText = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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
  const baseTextLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const responsiveTextLayoutEntries = toResponsiveLayoutMediaEntries({
    baseLayoutMode: element.layoutMode ?? "NONE",
    overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
    spacingBase: context.spacingBase,
    baseValuesByKey: toSxValueMapFromEntries(baseTextLayoutEntries)
  });
  const textLayoutEntries = [
    ...baseTextLayoutEntries.filter(([key]) => {
      return key !== "width" && key !== "height" && key !== "minHeight";
    }),
    ...responsiveTextLayoutEntries
  ];

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

export const firstText = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string | undefined => {
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

export const collectTextNodes = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const local = element.type === "text" && element.text?.trim() ? [element] : [];
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


export const renderFallbackIconExpression = ({
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


export const renderInlineSvgIcon = ({
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

export const renderSemanticInput = (
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
  const textFieldDefaults = context.themeComponentDefaults?.MuiTextField;
  const outlinedInputRadiusSource = outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius;
  const omitOutlinedInputBorderRadius = matchesRoundedInteger({
    value: outlinedInputRadiusSource,
    target: textFieldDefaults?.outlinedInputBorderRadiusPx
  });
  const baseFieldLayoutEntries = baseLayoutEntries(outlineContainer, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const fieldSxEntries: Array<[string, string | number | undefined]> = [
    ...baseFieldLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: outlineContainer.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[outlineContainer.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseFieldLayoutEntries)
    }),
    ["bgcolor", toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens })] as [string, string | number | undefined]
  ];

  const inputRootStyle = sxString([
    [
      "borderRadius",
      !omitOutlinedInputBorderRadius
        ? toThemeBorderRadiusValue({
            radiusPx: outlinedInputRadiusSource,
            tokens: context.tokens
          })
        : undefined
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
  const usesReactHookForm = context.formHandlingMode === "react_hook_form";

  if (field.isSelect) {
    registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem", "FormHelperText");
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiFormControl",
      entries: fieldSxEntries
    });
    const fieldSx = sxString(
      withOmittedSxKeys({
        entries: fieldSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiFormControl",
          entries: fieldSxEntries
        })
      })
    );
    const selectLabelId = `${field.key}-label`;
    const selectSxEntries = [
      inputRootStyle,
      outlineStyle ? `"& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }` : undefined
    ].filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));
    const selectSxProp =
      selectSxEntries.length > 0
        ? `${indent}    sx={{
${selectSxEntries.map((entry) => `${indent}      ${entry}`).join(",\n")}
${indent}    }}\n`
        : "";
    if (usesReactHookForm) {
      return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <FormControl
${field.required ? `${indent}        required\n` : ""}${indent}        error={Boolean(helperText)}
${indent}        sx={{ ${fieldSx} }}
${indent}      >
${indent}        <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}        <Select
${indent}          labelId={${literal(selectLabelId)}}
${indent}          label={${literal(field.label)}}
${indent}          value={controllerField.value ?? ""}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(String(event.target.value))}
${indent}          onBlur={controllerField.onBlur}
${indent}          aria-describedby={${literal(helperTextId)}}
${field.required ? `${indent}          aria-required="true"\n` : ""}${indent}          aria-label={${literal(field.label)}}
${selectSxProp}
${indent}        >
${indent}          {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}            <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}          ))}
${indent}        </Select>
${indent}        <FormHelperText id={${literal(helperTextId)}}>{helperText}</FormHelperText>
${indent}      </FormControl>
${indent}    );
${indent}  }}
${indent}/>`;
    }
    return `${indent}<FormControl
${requiredProp}${indent}    error={${fieldErrorExpression}}
${indent}    sx={{ ${fieldSx} }}
${indent}  >
${indent}  <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(selectLabelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
${indent}    onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}    aria-describedby={${literal(helperTextId)}}
${ariaRequiredProp}${indent}    aria-label={${literal(field.label)}}
${selectSxProp}
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
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiTextField",
    entries: fieldSxEntries
  });
  const fieldSx = sxString(
    withOmittedSxKeys({
      entries: fieldSxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiTextField",
        entries: fieldSxEntries
      })
    })
  );
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
  const textFieldSxEntries = [
    fieldSx,
    inputRootStyle ? `"& .MuiOutlinedInput-root": { ${inputRootStyle} }` : undefined,
    outlineStyle ? `"& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }` : undefined,
    inputLabelStyle ? `"& .MuiInputLabel-root": { ${inputLabelStyle} }` : undefined
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length > 0));
  const textFieldSxProp =
    textFieldSxEntries.length > 0
      ? `${indent}  sx={{
${textFieldSxEntries.map((entry) => `${indent}    ${entry}`).join(",\n")}
${indent}  }}\n`
      : "";
  if (usesReactHookForm) {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <TextField
${indent}        label={${literal(field.label)}}
${field.placeholder ? `${indent}        placeholder={${literal(field.placeholder)}}\n` : ""}${field.inputType ? `${indent}        type={${literal(field.inputType)}}\n` : ""}${field.autoComplete ? `${indent}        autoComplete={${literal(field.autoComplete)}}\n` : ""}${field.required ? `${indent}        required\n` : ""}${indent}        value={controllerField.value ?? ""}
${indent}        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => controllerField.onChange(event.target.value)}
${indent}        onBlur={controllerField.onBlur}
${indent}        error={Boolean(helperText)}
${indent}        helperText={helperText}
${indent}        aria-label={${literal(field.label)}}
${indent}        aria-describedby={${literal(helperTextId)}}
${textFieldSxProp}
${indent}        slotProps={{
${indent}          ${slotPropsEntries}
${indent}        }}
${indent}      />
${indent}    );
${indent}  }}
${indent}/>`;
  }
  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${placeholderProp}${typeProp}${autoCompleteProp}${textFieldRequiredProp}${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  onBlur={() => handleFieldBlur(${literal(field.key)})}
${indent}  error={${fieldErrorExpression}}
${indent}  helperText={${fieldHelperTextExpression}}
${indent}  aria-label={${literal(field.label)}}
${indent}  aria-describedby={${literal(helperTextId)}}
${textFieldSxProp}
${indent}  slotProps={{
${indent}    ${slotPropsEntries}
${indent}  }}
${indent}/>`;
};

export const renderSemanticAccordion = (
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

  const baseAccordionLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const accordionSx = sxString([
    ...baseAccordionLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAccordionLayoutEntries)
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


export const renderButton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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
    const baseIconButtonLayoutEntries = baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens
    });
    const iconButtonSxEntries: Array<[string, string | number | undefined]> = [
      ...baseIconButtonLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseIconButtonLayoutEntries)
      }),
      ["color", toThemeColorLiteral({ color: iconColor, tokens: context.tokens })] as [string, string | number | undefined]
    ];
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiIconButton",
      entries: iconButtonSxEntries
    });
    const iconButtonSx = sxString(
      withOmittedSxKeys({
        entries: iconButtonSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiIconButton",
          entries: iconButtonSxEntries
        })
      })
    );
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
  const buttonLabel = (label ?? element.name).trim() || "Button";
  context.buttons.push({
    key: buttonKey,
    label: buttonLabel,
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

  const baseButtonLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const sxEntries = filterButtonVariantEntries({
    entries: [
      ...baseButtonLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseButtonLayoutEntries)
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
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiButton",
    entries: sxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: sxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiButton",
        entries: sxEntries
      })
    })
  );

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

export const isPillShapedOutlinedButton = (element: ScreenElementIR): boolean => {
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

export const renderChildrenIntoParent = ({
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

export const renderNodesIntoParent = ({
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

export const SIMPLE_STACK_GEOMETRY_SX_KEYS: Set<string> = new Set([
  "position",
  "left",
  "top",
  "width",
  "maxWidth",
  "height",
  "minHeight"
]);

export const hasResponsiveTopLevelLayoutOverrides = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): boolean => {
  return Boolean(context.responsiveTopLevelLayoutOverrides?.[element.id]);
};

export const hasVisibleBorderSignal = (element: ScreenElementIR): boolean => {
  if (!element.strokeColor) {
    return false;
  }
  if (element.strokeWidth === undefined) {
    return true;
  }
  return Number.isFinite(element.strokeWidth) && element.strokeWidth > 0;
};

export const hasDistinctSurfaceFill = ({
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

export const isElevatedSurfaceContainerForPaper = ({
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

export const isSimpleFlexContainerForStack = ({
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

export const toSimpleStackContainerSx = ({
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

export const renderSimpleFlexContainerAsStack = ({
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

export interface RenderedItem {
  id: string;
  label: string;
  node: ScreenElementIR;
}

export interface DetectedTabInterfacePattern {
  tabStripNode: ScreenElementIR;
  tabItems: RenderedItem[];
  panelNodes: ScreenElementIR[];
}

export interface DialogActionModel {
  id: string;
  label: string;
  isPrimary: boolean;
}

export interface DetectedDialogOverlayPattern {
  panelNode: ScreenElementIR;
  title: string | undefined;
  contentNodes: ScreenElementIR[];
  actionModels: DialogActionModel[];
}


export const renderListFromRows = ({
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

export const collectRenderedItems = (element: ScreenElementIR, generationLocale?: string): RenderedItem[] => {
  const sortOptions = generationLocale ? { generationLocale } : undefined;
  return sortChildren(element.children ?? [], element.layoutMode ?? "NONE", sortOptions)
    .map((child, index) => ({
      id: child.id || `${element.id}-item-${index + 1}`,
      label: firstText(child)?.trim() || child.name || `Item ${index + 1}`,
      node: child
    }))
    .filter((entry) => entry.label.trim().length > 0);
};

export const collectRenderedItemLabels = (element: ScreenElementIR, generationLocale?: string): Array<{ id: string; label: string }> => {
  return collectRenderedItems(element, generationLocale).map((item) => ({
    id: item.id,
    label: item.label
  }));
};


export const renderGridLayout = ({
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

export const toResponsiveBreakpointValuesLiteral = (values: Record<ResponsiveBreakpoint, number>): string => {
  return `{ ${RESPONSIVE_BREAKPOINT_ORDER.map((breakpoint) => `${breakpoint}: ${values[breakpoint]}`).join(", ")} }`;
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


export const renderCard = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  if ((element.children?.length ?? 0) === 0 && !hasVisualStyle(element)) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Card", "CardContent");
  const indent = "  ".repeat(depth);
  const cardElevation = normalizeElevationForSx(element.elevation);
  const cardDefaults = context.themeComponentDefaults?.MuiCard;
  const omitSxKeys = new Set<string>();
  if (
    matchesRoundedInteger({
      value: element.cornerRadius,
      target: cardDefaults?.borderRadiusPx
    })
  ) {
    omitSxKeys.add("borderRadius");
  }
  const omitDefaultElevation =
    typeof cardElevation === "number" &&
    cardElevation > 0 &&
    typeof cardDefaults?.elevation === "number" &&
    cardDefaults.elevation === cardElevation;
  if (omitDefaultElevation) {
    omitSxKeys.add("boxShadow");
  }
  const baseCardLayoutEntries = baseLayoutEntries(element, parent, {
    preferInsetShadow: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const cardSxEntries = [
    ...baseCardLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseCardLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiCard",
    entries: cardSxEntries
  });
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiCard",
    entries: cardSxEntries
  })) {
    omitSxKeys.add(key);
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: cardSxEntries,
      keys: omitSxKeys
    })
  );
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const elevationProp = typeof cardElevation === "number" && cardElevation > 0 && !omitDefaultElevation ? ` elevation={${cardElevation}}` : "";
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
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Card${elevationProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${sxProp}>
${mediaBlock}${contentBlock}${actionsBlock}
${indent}</Card>`;
};

export const renderChip = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Chip");
  const indent = "  ".repeat(depth);
  const mappedMuiProps = element.variantMapping?.muiProps;
  const chipDefaults = context.themeComponentDefaults?.MuiChip;
  const baseChipLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const chipLayoutEntries = [
    ...baseChipLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseChipLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiChip",
    entries: chipLayoutEntries
  });
  const chipMatchedDefaultKeys = collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiChip",
    entries: chipLayoutEntries
  });
  const chipSxEntries = withOmittedSxKeys({
    entries: chipLayoutEntries,
    keys: new Set<string>([
      ...chipMatchedDefaultKeys,
      ...(matchesRoundedInteger({
        value: element.cornerRadius,
        target: chipDefaults?.borderRadiusPx
      })
        ? ["borderRadius"]
        : [])
    ])
  });
  const sx = appendVariantStateOverridesToSx({
    sx: sxString(chipSxEntries),
    element,
    tokens: context.tokens
  });
  const label = firstText(element)?.trim() || element.name;
  const chipVariant = toChipVariant(mappedMuiProps?.variant);
  const chipSize = toChipSize(mappedMuiProps?.size);
  const isThemeDefaultChipSize = chipSize && chipDefaults?.size ? chipSize === chipDefaults.size : false;
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const variantProp = chipVariant ? ` variant="${chipVariant}"` : "";
  const sizeProp = chipSize && !isThemeDefaultChipSize ? ` size="${chipSize}"` : "";
  const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
  const linkProps = navigation && !mappedMuiProps?.disabled ? toRouterLinkProps({ navigation, context }) : "";
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Chip label={${literal(label)}}${linkProps}${variantProp}${sizeProp}${disabledProp}${sxProp} />`;
};

export const renderSelectionControl = ({
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

export const renderList = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const isLikelyAppBarToolbarActionNode = ({
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

export interface AppBarToolbarActionModel {
  node: ScreenElementIR;
  iconNode: ScreenElementIR;
  ariaLabel: string;
}

export const renderStructuredAppBarToolbarChildren = ({
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

export const renderAppBar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "AppBar", "Toolbar", "Typography");
  const indent = "  ".repeat(depth);
  const appBarDefaults = context.themeComponentDefaults?.MuiAppBar;
  const appBarBackgroundMatchesDefault =
    normalizeHexColor(element.fillColor) !== undefined &&
    normalizeHexColor(element.fillColor) === normalizeHexColor(appBarDefaults?.backgroundColor);
  const baseAppBarLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const appBarSxEntries = [
    ...baseAppBarLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAppBarLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiAppBar",
    entries: appBarSxEntries
  });
  const appBarMatchedDefaultKeys = collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiAppBar",
    entries: appBarSxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: appBarSxEntries,
      keys: new Set<string>([
        ...appBarMatchedDefaultKeys,
        ...(appBarBackgroundMatchesDefault ? ["bgcolor"] : [])
      ])
    })
  );
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
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<AppBar role="banner" position="static"${sxProp}>
${indent}  <Toolbar>
${renderedChildren || `${indent}    <Typography variant="h6">{${literal(fallbackTitle)}}</Typography>`}
${indent}  </Toolbar>
${indent}</AppBar>`;
};

export const renderTabs = (
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

export const renderDialog = (
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

export const renderStepper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderProgress = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderAvatar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const content = firstText(element)?.trim();
  if (!content && !hasVisualStyle(element) && (element.children?.length ?? 0) === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Avatar");
  const indent = "  ".repeat(depth);
  const avatarDefaults = context.themeComponentDefaults?.MuiAvatar;
  const baseAvatarLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const avatarSxEntries = [
    ...baseAvatarLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseAvatarLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiAvatar",
    entries: avatarSxEntries
  });
  const hasRelativeWidthLogic = avatarSxEntries.some(([key, value]) => key === "maxWidth" && value !== undefined);
  const omitSxKeys = new Set<string>();
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiAvatar",
    entries: avatarSxEntries
  })) {
    omitSxKeys.add(key);
  }
  if (
    matchesRoundedInteger({
      value: element.cornerRadius,
      target: avatarDefaults?.borderRadiusPx
    })
  ) {
    omitSxKeys.add("borderRadius");
  }
  if (
    !hasRelativeWidthLogic &&
    matchesRoundedInteger({
      value: element.width,
      target: avatarDefaults?.widthPx
    })
  ) {
    omitSxKeys.add("width");
  }
  if (
    !hasRelativeWidthLogic &&
    matchesRoundedInteger({
      value: element.height,
      target: avatarDefaults?.heightPx
    })
  ) {
    omitSxKeys.add("height");
    omitSxKeys.add("minHeight");
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: avatarSxEntries,
      keys: omitSxKeys
    })
  );
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Avatar${sxProp}>${content ? `{${literal(content)}}` : ""}</Avatar>`;
};

export const renderBadge = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderDividerElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Divider");
  const indent = "  ".repeat(depth);
  const dividerDefaultColor = context.themeComponentDefaults?.MuiDivider?.borderColor;
  const matchesDefaultBorderColor =
    normalizeHexColor(element.fillColor) !== undefined &&
    normalizeHexColor(element.fillColor) === normalizeHexColor(dividerDefaultColor);
  const baseDividerLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const dividerSxEntries: Array<[string, string | number | undefined]> = [
    ...baseDividerLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseDividerLayoutEntries)
    }),
    [
      "borderColor",
      !matchesDefaultBorderColor ? toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens }) : undefined
    ] as [string, string | number | undefined]
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiDivider",
    entries: dividerSxEntries
  });
  const sx = sxString(
    withOmittedSxKeys({
      entries: dividerSxEntries,
      keys: collectThemeDefaultMatchedSxKeys({
        context,
        componentName: "MuiDivider",
        entries: dividerSxEntries
      })
    })
  );
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  return `${indent}<Divider aria-hidden="true"${sxProp} />`;
};

export const renderNavigation = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderGrid = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderStack = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderPaper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Paper");
  const indent = "  ".repeat(depth);
  const elevation = normalizeElevationForSx(element.elevation);
  const paperDefaults = context.themeComponentDefaults?.MuiPaper;
  const omitDefaultElevation =
    typeof elevation === "number" &&
    elevation > 0 &&
    typeof paperDefaults?.elevation === "number" &&
    paperDefaults.elevation === elevation;
  const variant = elevation && elevation > 0 ? undefined : element.strokeColor ? "outlined" : undefined;
  const basePaperLayoutEntries = baseLayoutEntries(element, parent, {
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const paperSxEntries = [
    ...basePaperLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(basePaperLayoutEntries)
    })
  ];
  collectThemeSxSampleFromEntries({
    context,
    componentName: "MuiPaper",
    entries: paperSxEntries
  });
  const omitPaperKeys = new Set<string>();
  for (const key of collectThemeDefaultMatchedSxKeys({
    context,
    componentName: "MuiPaper",
    entries: paperSxEntries
  })) {
    omitPaperKeys.add(key);
  }
  if (omitDefaultElevation) {
    omitPaperKeys.add("boxShadow");
  }
  const sx = sxString(
    withOmittedSxKeys({
      entries: paperSxEntries,
      keys: omitPaperKeys
    })
  );
  const navigation = resolvePrototypeNavigationBinding({ element, context });
  const navigationProps = navigation ? toNavigateHandlerProps({ navigation, context }) : undefined;
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  const elevationProp = typeof elevation === "number" && elevation > 0 && !omitDefaultElevation ? ` elevation={${elevation}}` : "";
  const variantProp = variant ? ` variant="${variant}"` : "";
  const landmarkRole = inferLandmarkRole({ element, context });
  const isDecorative = !landmarkRole && isDecorativeElement({ element, context });
  const roleProp = navigationProps?.roleProp ?? (landmarkRole ? ` role="${landmarkRole}"` : "");
  const tabIndexProp = navigationProps?.tabIndexProp ?? "";
  const onClickProp = navigationProps?.onClickProp ?? "";
  const onKeyDownProp = navigationProps?.onKeyDownProp ?? "";
  const ariaHiddenProp = navigationProps ? "" : isDecorative ? ' aria-hidden="true"' : "";
  const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
  if (!renderedChildren.trim()) {
    return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp} />`;
  }
  return `${indent}<Paper${elevationProp}${variantProp}${roleProp}${tabIndexProp}${onClickProp}${onKeyDownProp}${ariaHiddenProp}${sxProp}>
${renderedChildren}
${indent}</Paper>`;
};

export const subtreeContainsElementType = (element: ScreenElementIR, targetType: ScreenElementIR["type"]): boolean => {
  if (element.type === targetType) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsElementType(child, targetType));
};

export const renderTable = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderTooltipElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderDrawer = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderBreadcrumbs = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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

export const renderSlider = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderSelectElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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
  if (context.formHandlingMode === "react_hook_form") {
    return `${indent}<Controller
${indent}  name={${literal(field.key)}}
${indent}  control={control}
${indent}  render={({ field: controllerField, fieldState }) => {
${indent}    const helperText = resolveFieldErrorMessage({
${indent}      fieldKey: ${literal(field.key)},
${indent}      isTouched: fieldState.isTouched,
${indent}      fieldError: typeof fieldState.error?.message === "string" ? fieldState.error.message : undefined
${indent}    });
${indent}    return (
${indent}      <FormControl
${field.required ? `${indent}        required\n` : ""}${indent}        error={Boolean(helperText)}
${indent}        sx={{ ${sx} }}
${indent}      >
${indent}        <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}        <Select
${indent}          labelId={${literal(labelId)}}
${indent}          label={${literal(field.label)}}
${indent}          value={controllerField.value ?? ""}
${indent}          onChange={(event: SelectChangeEvent<string>) => controllerField.onChange(String(event.target.value))}
${indent}          onBlur={controllerField.onBlur}
${indent}          aria-describedby={${literal(helperTextId)}}
${field.required ? `${indent}          aria-required="true"\n` : ""}${indent}          aria-label={${literal(field.label)}}
${indent}        >
${indent}          {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}            <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}          ))}
${indent}        </Select>
${indent}        <FormHelperText id={${literal(helperTextId)}}>{helperText}</FormHelperText>
${indent}      </FormControl>
${indent}    );
${indent}  }}
${indent}/>`;
  }
  return `${indent}<FormControl
${requiredProp}${indent}  error={${fieldErrorExpression}}
${indent}  sx={{ ${sx} }}
${indent}>
${indent}  <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(labelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event: SelectChangeEvent<string>) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
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

export const renderRatingElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderSnackbar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderSkeleton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
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

export const renderImageElement = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Box");
  const indent = "  ".repeat(depth);
  const baseImageLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const sx = sxString([
    ...baseImageLayoutEntries,
    ...toResponsiveLayoutMediaEntries({
      baseLayoutMode: element.layoutMode ?? "NONE",
      overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
      spacingBase: context.spacingBase,
      baseValuesByKey: toSxValueMapFromEntries(baseImageLayoutEntries)
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

export interface ElementRenderStrategyInput {
  element: ScreenElementIR;
  depth: number;
  parent: VirtualParent;
  context: RenderContext;
}

export interface ContainerRenderStrategyMatch {
  matched: true;
  rendered: string | null;
}

export type ContainerRenderStrategy = (input: ElementRenderStrategyInput) => ContainerRenderStrategyMatch | undefined;
export type ElementRenderStrategy = (input: ElementRenderStrategyInput) => string | null;
export type PreDispatchRenderStrategy = (input: ElementRenderStrategyInput) => string | null | undefined;

export const asContainerStrategyMatch = (rendered: string | null): ContainerRenderStrategyMatch => {
  return {
    matched: true,
    rendered
  };
};

export const renderContainerIconWrapper = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | undefined => {
  if (!(isIconLikeNode(element) || isSemanticIconWrapper(element)) || hasMeaningfulTextDescendants({ element, context })) {
    return undefined;
  }
  const baseIconWrapperLayoutEntries = baseLayoutEntries(element, parent, {
    includePaints: false,
    spacingBase: context.spacingBase,
    tokens: context.tokens
  });
  const iconExpression = renderFallbackIconExpression({
    element,
    parent,
    context,
    ariaHidden: true,
    extraEntries: [
      ...baseIconWrapperLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseIconWrapperLayoutEntries)
      }),
      ["display", literal("flex")],
      ["alignItems", literal("center")],
      ["justifyContent", literal("center")]
    ]
  });
  const indent = "  ".repeat(depth);
  return `${indent}${iconExpression}`;
};

export const tryRenderAccordionContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isLikelyAccordionContainer(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderSemanticAccordion(element, depth, parent, context));
};

export const tryRenderInputContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isLikelyInputContainer(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderSemanticInput(element, depth, parent, context));
};

export const tryRenderPillShapedButtonContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isPillShapedOutlinedButton(element)) {
    return undefined;
  }
  return asContainerStrategyMatch(renderButton(element, depth, parent, context));
};

export const tryRenderIconLikeContainer: ContainerRenderStrategy = (input) => {
  const renderedIconWrapper = renderContainerIconWrapper(input);
  if (renderedIconWrapper === undefined) {
    return undefined;
  }
  return asContainerStrategyMatch(renderedIconWrapper);
};

export const tryRenderGridLikeContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  const detectedGridLayout = detectGridLikeContainerLayout(element);
  if (!detectedGridLayout) {
    return undefined;
  }
  const renderedGrid = renderGridLayout({
    element,
    depth,
    parent,
    context,
    includePaints: true,
    equalColumns: detectedGridLayout.mode === "equal-row",
    columnCountHint: detectedGridLayout.columnCount
  });
  if (!renderedGrid) {
    return undefined;
  }
  return asContainerStrategyMatch(renderedGrid);
};

export const tryRenderPaperSurfaceContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isElevatedSurfaceContainerForPaper({ element, context })) {
    return undefined;
  }
  return asContainerStrategyMatch(renderPaper(element, depth, parent, context));
};

export const tryRenderRepeatedListContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  const detectedListPattern = detectRepeatedListPattern({
    element,
    generationLocale: context.generationLocale
  });
  if (!detectedListPattern) {
    return undefined;
  }
  return asContainerStrategyMatch(
    renderListFromRows({
      element,
      rows: detectedListPattern.rows,
      hasInterItemDivider: detectedListPattern.hasInterItemDivider,
      depth,
      parent,
      context
    })
  );
};

export const tryRenderSimpleFlexContainer: ContainerRenderStrategy = ({ element, depth, parent, context }) => {
  if (!isSimpleFlexContainerForStack({ element, context })) {
    return undefined;
  }
  return asContainerStrategyMatch(
    renderSimpleFlexContainerAsStack({
      element,
      depth,
      parent,
      context
    })
  );
};

export const CONTAINER_RENDER_STRATEGIES: readonly ContainerRenderStrategy[] = [
  tryRenderAccordionContainer,
  tryRenderInputContainer,
  tryRenderPillShapedButtonContainer,
  tryRenderIconLikeContainer,
  tryRenderGridLikeContainer,
  tryRenderPaperSurfaceContainer,
  tryRenderRepeatedListContainer,
  tryRenderSimpleFlexContainer
];

export const renderContainerFallback = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | null => {
  const indent = "  ".repeat(depth);
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE", {
    generationLocale: context.generationLocale
  });

  const renderedChildren = children
    .map((child) =>
      renderElement(
        child,
        depth + 1,
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

  const isDivider = (element.height ?? 0) <= 2 && Boolean(element.fillColor) && !children.length;
  if (isDivider) {
    const dividerDefaultColor = context.themeComponentDefaults?.MuiDivider?.borderColor;
    const matchesDefaultBorderColor =
      normalizeHexColor(element.fillColor) !== undefined &&
      normalizeHexColor(element.fillColor) === normalizeHexColor(dividerDefaultColor);
    const baseDividerLayoutEntries = baseLayoutEntries(element, parent, {
      spacingBase: context.spacingBase,
      tokens: context.tokens
    });
    const dividerSxEntries: Array<[string, string | number | undefined]> = [
      ...baseDividerLayoutEntries,
      ...toResponsiveLayoutMediaEntries({
        baseLayoutMode: element.layoutMode ?? "NONE",
        overrides: context.responsiveTopLevelLayoutOverrides?.[element.id],
        spacingBase: context.spacingBase,
        baseValuesByKey: toSxValueMapFromEntries(baseDividerLayoutEntries)
      }),
      [
        "borderColor",
        !matchesDefaultBorderColor ? toThemeColorLiteral({ color: element.fillColor, tokens: context.tokens }) : undefined
      ] as [string, string | number | undefined]
    ];
    collectThemeSxSampleFromEntries({
      context,
      componentName: "MuiDivider",
      entries: dividerSxEntries
    });
    const sx = sxString(
      withOmittedSxKeys({
        entries: dividerSxEntries,
        keys: collectThemeDefaultMatchedSxKeys({
          context,
          componentName: "MuiDivider",
          entries: dividerSxEntries
        })
      })
    );
    registerMuiImports(context, "Divider");
    const sxProp = sx.trim() ? ` sx={{ ${sx} }}` : "";
    return `${indent}<Divider aria-hidden="true"${sxProp} />`;
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

export const renderContainer = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const strategyInput: ElementRenderStrategyInput = {
    element,
    depth,
    parent,
    context
  };
  for (const strategy of CONTAINER_RENDER_STRATEGIES) {
    const result = strategy(strategyInput);
    if (result?.matched) {
      return result.rendered;
    }
  }
  return renderContainerFallback(strategyInput);
};

export const runElementPreDispatchStrategies = ({
  element,
  depth,
  parent,
  context
}: ElementRenderStrategyInput): string | null | undefined => {
  const preDispatchStrategies: readonly PreDispatchRenderStrategy[] = [
    ({ element, depth, parent, context }) => {
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
      return undefined;
    },
    ({ element, depth, parent, context }) => {
      const tabInterfacePattern = detectTabInterfacePattern({
        element,
        depth,
        context
      });
      if (!tabInterfacePattern) {
        return undefined;
      }
      return renderTabs(element, depth, parent, context, tabInterfacePattern);
    },
    ({ element, depth, parent, context }) => {
      const dialogOverlayPattern = detectDialogOverlayPattern({
        element,
        depth,
        parent,
        context
      });
      if (!dialogOverlayPattern) {
        return undefined;
      }
      return renderDialog(element, depth, parent, context, dialogOverlayPattern);
    }
  ];
  for (const strategy of preDispatchStrategies) {
    const rendered = strategy({
      element,
      depth,
      parent,
      context
    });
    if (rendered !== undefined) {
      return rendered;
    }
  }
  return undefined;
};

export const elementRenderStrategies: Partial<Record<ScreenElementIR["type"], ElementRenderStrategy>> = {
  text: ({ element, depth, parent, context }) => renderText(element, depth, parent, context),
  input: ({ element, depth, parent, context }) => renderSemanticInput(element, depth, parent, context),
  select: ({ element, depth, parent, context }) => renderSelectElement(element, depth, parent, context),
  button: ({ element, depth, parent, context }) => renderButton(element, depth, parent, context),
  grid: ({ element, depth, parent, context }) => renderGrid(element, depth, parent, context),
  stack: ({ element, depth, parent, context }) => renderStack(element, depth, parent, context),
  paper: ({ element, depth, parent, context }) => renderPaper(element, depth, parent, context),
  card: ({ element, depth, parent, context }) => renderCard(element, depth, parent, context),
  chip: ({ element, depth, parent, context }) => renderChip(element, depth, parent, context),
  switch: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Switch"
    }),
  checkbox: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Checkbox"
    }),
  radio: ({ element, depth, parent, context }) =>
    renderSelectionControl({
      element,
      depth,
      parent,
      context,
      componentName: "Radio"
    }),
  slider: ({ element, depth, parent, context }) => renderSlider(element, depth, parent, context),
  rating: ({ element, depth, parent, context }) => renderRatingElement(element, depth, parent, context),
  list: ({ element, depth, parent, context }) => renderList(element, depth, parent, context),
  table: ({ element, depth, parent, context }) => renderTable(element, depth, parent, context),
  tooltip: ({ element, depth, parent, context }) => renderTooltipElement(element, depth, parent, context),
  appbar: ({ element, depth, parent, context }) => renderAppBar(element, depth, parent, context),
  drawer: ({ element, depth, parent, context }) => renderDrawer(element, depth, parent, context),
  breadcrumbs: ({ element, depth, parent, context }) => renderBreadcrumbs(element, depth, parent, context),
  tab: ({ element, depth, parent, context }) => renderTabs(element, depth, parent, context),
  dialog: ({ element, depth, parent, context }) => renderDialog(element, depth, parent, context),
  snackbar: ({ element, depth, parent, context }) => renderSnackbar(element, depth, parent, context),
  stepper: ({ element, depth, parent, context }) => renderStepper(element, depth, parent, context),
  progress: ({ element, depth, parent, context }) => renderProgress(element, depth, parent, context),
  skeleton: ({ element, depth, parent, context }) => renderSkeleton(element, depth, parent, context),
  avatar: ({ element, depth, parent, context }) => renderAvatar(element, depth, parent, context),
  badge: ({ element, depth, parent, context }) => renderBadge(element, depth, parent, context),
  divider: ({ element, depth, parent, context }) => renderDividerElement(element, depth, parent, context),
  navigation: ({ element, depth, parent, context }) => renderNavigation(element, depth, parent, context),
  image: ({ element, depth, parent, context }) => renderImageElement(element, depth, parent, context),
  container: ({ element, depth, parent, context }) => renderContainer(element, depth, parent, context)
};

export const resolveElementRenderStrategy = (type: ScreenElementIR["type"]): ElementRenderStrategy => {
  return (
    elementRenderStrategies[type] ??
    (({ element, depth, parent, context }) => {
      return renderContainer(element, depth, parent, context);
    })
  );
};

export const renderElement = (
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
    const extractionInvocation = context.extractionInvocationByNodeId.get(element.id);
    if (extractionInvocation) {
      const indent = "  ".repeat(depth);
      const sx = toElementSx({
        element,
        parent,
        context
      });
      const propEntries = extractionInvocation.usesPatternContext
        ? [`instanceId={${literal(extractionInvocation.instanceId)}}`]
        : Object.entries(extractionInvocation.propValues)
            .filter(([, value]) => value !== undefined)
            .map(([propName, value]) => `${propName}={${literal(value as string)}}`);
      const props = [`sx={{ ${sx} }}`, ...propEntries].join(" ");
      return `${indent}<${extractionInvocation.componentName} ${props} />`;
    }

    const mappedElement = renderMappedElement(element, depth, parent, context);
    if (mappedElement) {
      return mappedElement;
    }

    if (element.nodeType === "VECTOR" && element.type !== "image") {
      return null;
    }

    const preDispatchRendered = runElementPreDispatchStrategies({
      element,
      depth,
      parent,
      context
    });
    if (preDispatchRendered !== undefined) {
      return preDispatchRendered;
    }
    return resolveElementRenderStrategy(element.type)({
      element,
      depth,
      parent,
      context
    });
  } finally {
    context.activeRenderElements.delete(element);
  }
};


export interface ThemeComponentBlockDraft {
  defaultPropsEntries: Array<[string, string | number]>;
  rootStyleEntries: Array<[string, ThemeSxStyleValue]>;
  nestedRootStyleEntries: Array<{
    selector: string;
    entries: Array<[string, ThemeSxStyleValue]>;
  }>;
}

export const toThemeSxStyleValueLiteral = (value: ThemeSxStyleValue): string => {
  if (typeof value === "number") {
    return String(roundStableSxNumericValue(value));
  }
  return literal(value);
};

export const createThemeComponentBlockDraft = ({
  componentName,
  themeComponentDefaults
}: {
  componentName: string;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}): ThemeComponentBlockDraft => {
  const draft: ThemeComponentBlockDraft = {
    defaultPropsEntries: [],
    rootStyleEntries: [],
    nestedRootStyleEntries: []
  };

  if (componentName === "MuiButton") {
    draft.rootStyleEntries.push(["textTransform", "none"]);
    return draft;
  }
  if (componentName === "MuiCard") {
    if (themeComponentDefaults?.MuiCard?.elevation !== undefined) {
      draft.defaultPropsEntries.push(["elevation", themeComponentDefaults.MuiCard.elevation]);
    }
    if (themeComponentDefaults?.MuiCard?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiCard.borderRadiusPx}px`]);
    }
    return draft;
  }
  if (componentName === "MuiTextField") {
    if (themeComponentDefaults?.MuiTextField?.outlinedInputBorderRadiusPx !== undefined) {
      draft.nestedRootStyleEntries.push({
        selector: "& .MuiOutlinedInput-root",
        entries: [["borderRadius", `${themeComponentDefaults.MuiTextField.outlinedInputBorderRadiusPx}px`]]
      });
    }
    return draft;
  }
  if (componentName === "MuiChip") {
    if (themeComponentDefaults?.MuiChip?.size) {
      draft.defaultPropsEntries.push(["size", themeComponentDefaults.MuiChip.size]);
    }
    if (themeComponentDefaults?.MuiChip?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiChip.borderRadiusPx}px`]);
    }
    return draft;
  }
  if (componentName === "MuiPaper") {
    if (themeComponentDefaults?.MuiPaper?.elevation !== undefined) {
      draft.defaultPropsEntries.push(["elevation", themeComponentDefaults.MuiPaper.elevation]);
    }
    return draft;
  }
  if (componentName === "MuiAppBar") {
    if (themeComponentDefaults?.MuiAppBar?.backgroundColor) {
      draft.rootStyleEntries.push(["backgroundColor", themeComponentDefaults.MuiAppBar.backgroundColor]);
    }
    return draft;
  }
  if (componentName === "MuiDivider") {
    if (themeComponentDefaults?.MuiDivider?.borderColor) {
      draft.rootStyleEntries.push(["borderColor", themeComponentDefaults.MuiDivider.borderColor]);
    }
    return draft;
  }
  if (componentName === "MuiAvatar") {
    if (themeComponentDefaults?.MuiAvatar?.widthPx !== undefined) {
      draft.rootStyleEntries.push(["width", `${themeComponentDefaults.MuiAvatar.widthPx}px`]);
    }
    if (themeComponentDefaults?.MuiAvatar?.heightPx !== undefined) {
      draft.rootStyleEntries.push(["height", `${themeComponentDefaults.MuiAvatar.heightPx}px`]);
    }
    if (themeComponentDefaults?.MuiAvatar?.borderRadiusPx !== undefined) {
      draft.rootStyleEntries.push(["borderRadius", `${themeComponentDefaults.MuiAvatar.borderRadiusPx}px`]);
    }
    return draft;
  }
  return draft;
};

export const appendC1ThemeStyleEntriesToDraft = ({
  componentName,
  draft,
  themeComponentDefaults
}: {
  componentName: string;
  draft: ThemeComponentBlockDraft;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}): void => {
  const c1Entries = themeComponentDefaults?.c1StyleOverrides?.[componentName];
  if (!c1Entries) {
    return;
  }
  const existingRootKeys = new Set(draft.rootStyleEntries.map(([key]) => key));
  const orderedC1Keys = Object.keys(c1Entries).sort((left, right) => left.localeCompare(right));
  for (const key of orderedC1Keys) {
    if (existingRootKeys.has(key)) {
      continue;
    }
    const value = c1Entries[key];
    const normalizedValue = normalizeThemeSxValueForKey({
      key,
      value
    });
    if (normalizedValue === undefined) {
      continue;
    }
    draft.rootStyleEntries.push([key, normalizedValue]);
    existingRootKeys.add(key);
  }
};

export const renderThemeComponentBlock = ({
  componentName,
  draft
}: {
  componentName: string;
  draft: ThemeComponentBlockDraft;
}): string | undefined => {
  const componentEntries: string[] = [];
  if (draft.defaultPropsEntries.length > 0) {
    componentEntries.push(
      `      defaultProps: { ${draft.defaultPropsEntries
        .map(([key, value]) => `${key}: ${typeof value === "number" ? value : literal(value)}`)
        .join(", ")} }`
    );
  }
  if (draft.rootStyleEntries.length > 0 || draft.nestedRootStyleEntries.length > 0) {
    const rootEntries = draft.rootStyleEntries.map(
      ([key, value]) => `          ${key}: ${toThemeSxStyleValueLiteral(value)}`
    );
    for (const nestedEntry of draft.nestedRootStyleEntries) {
      const nestedLines = nestedEntry.entries.map(
        ([key, value]) => `            ${key}: ${toThemeSxStyleValueLiteral(value)}`
      );
      rootEntries.push(`          ${literal(nestedEntry.selector)}: {\n${nestedLines.join(",\n")}\n          }`);
    }
    componentEntries.push(`      styleOverrides: {\n        root: {\n${rootEntries.join(",\n")}\n        }\n      }`);
  }
  if (componentEntries.length === 0) {
    return undefined;
  }
  return `    ${componentName}: {\n${componentEntries.join(",\n")}\n    }`;
};

export const fallbackThemeFile = (ir: DesignIR, themeComponentDefaults?: ThemeComponentDefaults): GeneratedFile => {
  const tokens = ir.tokens;
  const lightPalette = toLightThemePalette(tokens);
  const darkPalette = toDarkThemePalette(tokens);
  const responsiveThemeBreakpoints = deriveResponsiveThemeBreakpointValues(ir);
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
  const c1ComponentNames = Object.keys(themeComponentDefaults?.c1StyleOverrides ?? {})
    .filter((componentName) => !THEME_COMPONENT_ORDER.includes(componentName))
    .sort((left, right) => left.localeCompare(right));
  const componentOrder = [...THEME_COMPONENT_ORDER, ...c1ComponentNames];
  const componentBlocks = componentOrder
    .map((componentName) => {
      const draft = createThemeComponentBlockDraft({
        componentName,
        themeComponentDefaults
      });
      appendC1ThemeStyleEntriesToDraft({
        componentName,
        draft,
        themeComponentDefaults
      });
      return renderThemeComponentBlock({
        componentName,
        draft
      });
    })
    .filter((block): block is string => Boolean(block));

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
${responsiveThemeBreakpoints ? `  breakpoints: {\n    values: ${toResponsiveBreakpointValuesLiteral(responsiveThemeBreakpoints)}\n  },\n` : ""}  typography: {
    fontFamily: "${tokens.fontFamily}",
${typographyEntries}
  },
  components: {
${componentBlocks.join(",\n")}
  }
});
`
  };
};

export interface FallbackScreenFileResult {
  file: GeneratedFile;
  componentFiles: GeneratedFile[];
  contextFiles: GeneratedFile[];
  testFiles: GeneratedFile[];
  prototypeNavigationRenderedCount: number;
  simplificationStats: SimplificationMetrics;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  accessibilityWarnings: AccessibilityWarning[];
}

export interface ScreenTestButtonTarget {
  label: string;
  clickable: boolean;
}

export interface ScreenTestTargetPlan {
  textTargets: string[];
  buttonTargets: ScreenTestButtonTarget[];
  textInputTargets: string[];
  selectTargets: string[];
}

export const toTruncationComment = (
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

export const MAX_SCREEN_TEST_TEXT_TARGETS = 8;
export const MAX_SCREEN_TEST_BUTTON_TARGETS = 6;
export const MAX_SCREEN_TEST_INPUT_TARGETS = 6;
export const MAX_SCREEN_TEST_SELECT_TARGETS = 6;
export const MAX_SCREEN_TEST_TARGET_TEXT_LENGTH = 120;
export const MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH = 3;

export const normalizeScreenTestTargetText = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_SCREEN_TEST_TARGET_TEXT_LENGTH) {
    return undefined;
  }
  if (/^[-–—•*]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
};

export const collectRepresentativeScreenTextTargets = ({
  roots,
  maxCount = MAX_SCREEN_TEST_TEXT_TARGETS
}: {
  roots: ScreenElementIR[];
  maxCount?: number;
}): string[] => {
  const seen = new Set<string>();
  const targets: string[] = [];
  const stack: ScreenElementIR[] = [...roots].reverse();

  while (stack.length > 0 && targets.length < maxCount) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === "text") {
      const normalizedText = normalizeScreenTestTargetText(current.text);
      if (normalizedText) {
        if (normalizedText.length < MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH) {
          continue;
        }
        const normalizedKey = normalizedText.toLowerCase();
        if (!seen.has(normalizedKey)) {
          seen.add(normalizedKey);
          targets.push(normalizedText);
          if (targets.length >= maxCount) {
            break;
          }
        }
      }
    }

    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        stack.push(child);
      }
    }
  }

  return targets;
};

export const normalizeRenderedScreenTextForSearch = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const filterTextTargetsByRenderedScreenOutput = ({
  textTargets,
  renderedOutput,
  maxCount = MAX_SCREEN_TEST_TEXT_TARGETS
}: {
  textTargets: string[];
  renderedOutput: string;
  maxCount?: number;
}): string[] => {
  const normalizedRenderedOutput = normalizeRenderedScreenTextForSearch(renderedOutput);
  if (!normalizedRenderedOutput) {
    return textTargets.slice(0, maxCount);
  }

  const filteredTargets: string[] = [];
  for (const target of textTargets) {
    const normalizedTarget = normalizeRenderedScreenTextForSearch(target);
    if (!normalizedTarget) {
      continue;
    }
    if (normalizedTarget.length < MIN_SCREEN_TEST_TEXT_ASSERTION_LENGTH) {
      continue;
    }
    if (!normalizedRenderedOutput.includes(normalizedTarget)) {
      continue;
    }
    filteredTargets.push(target);
    if (filteredTargets.length >= maxCount) {
      break;
    }
  }

  return filteredTargets;
};

export const collectRepresentativeScreenButtonTargets = ({
  buttons,
  maxCount = MAX_SCREEN_TEST_BUTTON_TARGETS
}: {
  buttons: RenderedButtonModel[];
  maxCount?: number;
}): ScreenTestButtonTarget[] => {
  const byLabel = new Map<string, ScreenTestButtonTarget>();
  for (const button of buttons) {
    const normalizedLabel = normalizeScreenTestTargetText(button.label);
    if (!normalizedLabel) {
      continue;
    }
    const key = normalizedLabel.toLowerCase();
    const existing = byLabel.get(key);
    if (!existing) {
      byLabel.set(key, {
        label: normalizedLabel,
        clickable: button.eligibleForSubmit
      });
      if (byLabel.size >= maxCount) {
        break;
      }
      continue;
    }
    if (button.eligibleForSubmit) {
      existing.clickable = true;
    }
  }
  return Array.from(byLabel.values());
};

export const collectRepresentativeFieldTargets = ({
  fields,
  isSelect,
  maxCount
}: {
  fields: InteractiveFieldModel[];
  isSelect: boolean;
  maxCount: number;
}): string[] => {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const field of fields) {
    if (field.isSelect !== isSelect) {
      continue;
    }
    const normalizedLabel = normalizeScreenTestTargetText(field.label);
    if (!normalizedLabel) {
      continue;
    }
    const key = normalizedLabel.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    labels.push(normalizedLabel);
    if (labels.length >= maxCount) {
      break;
    }
  }
  return labels;
};

export const buildScreenTestTargetPlan = ({
  roots,
  renderedOutput,
  buttons,
  fields
}: {
  roots: ScreenElementIR[];
  renderedOutput: string;
  buttons: RenderedButtonModel[];
  fields: InteractiveFieldModel[];
}): ScreenTestTargetPlan => {
  const collectedTextTargets = collectRepresentativeScreenTextTargets({
    roots,
    maxCount: MAX_SCREEN_TEST_TEXT_TARGETS
  });

  return {
    textTargets: filterTextTargetsByRenderedScreenOutput({
      textTargets: collectedTextTargets,
      renderedOutput,
      maxCount: MAX_SCREEN_TEST_TEXT_TARGETS
    }),
    buttonTargets: collectRepresentativeScreenButtonTargets({
      buttons,
      maxCount: MAX_SCREEN_TEST_BUTTON_TARGETS
    }),
    textInputTargets: collectRepresentativeFieldTargets({
      fields,
      isSelect: false,
      maxCount: MAX_SCREEN_TEST_INPUT_TARGETS
    }),
    selectTargets: collectRepresentativeFieldTargets({
      fields,
      isSelect: true,
      maxCount: MAX_SCREEN_TEST_SELECT_TARGETS
    })
  };
};

export const buildScreenUnitTestFile = ({
  componentName,
  screenFilePath,
  plan
}: {
  componentName: string;
  screenFilePath: string;
  plan: ScreenTestTargetPlan;
}): GeneratedFile => {
  const screenFileName = path.posix.basename(screenFilePath, ".tsx");
  const testFilePath = path.posix.join("src", "screens", "__tests__", `${componentName}.test.tsx`);
  const expectedButtonLabels = plan.buttonTargets.map((target) => target.label);
  const clickableButtonLabels = plan.buttonTargets.filter((target) => target.clickable).map((target) => target.label);

  const content = `import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { appTheme } from "../../theme/theme";
import ${componentName}Screen from "../${screenFileName}";

const expectedTexts: string[] = ${JSON.stringify(plan.textTargets, null, 2)};
const expectedButtonLabels: string[] = ${JSON.stringify(expectedButtonLabels, null, 2)};
const clickableButtonLabels: string[] = ${JSON.stringify(clickableButtonLabels, null, 2)};
const expectedTextInputLabels: string[] = ${JSON.stringify(plan.textInputTargets, null, 2)};
const expectedSelectLabels: string[] = ${JSON.stringify(plan.selectTargets, null, 2)};

const normalizeTextForAssertion = (value: string): string => {
  return value.replace(/\\s+/g, " ").trim();
};

const expectTextToBePresent = ({ container, expectedText }: { container: HTMLElement; expectedText: string }): void => {
  const normalizedExpectedText = normalizeTextForAssertion(expectedText);
  if (normalizedExpectedText.length === 0) {
    return;
  }
  const normalizedContainerText = normalizeTextForAssertion(container.textContent ?? "");
  expect(normalizedContainerText).toContain(normalizedExpectedText);
};

const axeConfig = {
  rules: {
    "heading-order": { enabled: false },
    "landmark-banner-is-top-level": { enabled: false }
  }
} as const;

const renderScreen = () => {
  return render(
    <ThemeProvider theme={appTheme} defaultMode="system" noSsr>
      <MemoryRouter>
        <${componentName}Screen />
      </MemoryRouter>
    </ThemeProvider>
  );
};

describe("${componentName}Screen", () => {
  it("renders without crashing", () => {
    const { container } = renderScreen();
    expect(container.firstChild).not.toBeNull();
  });

  it("renders representative text content", () => {
    const { container } = renderScreen();
    for (const expectedText of expectedTexts) {
      expectTextToBePresent({ container, expectedText });
    }
  });

  it("keeps representative controls interactive", async () => {
    renderScreen();
    const user = userEvent.setup();

    for (const buttonLabel of expectedButtonLabels) {
      expect(screen.getAllByRole("button", { name: buttonLabel }).length).toBeGreaterThan(0);
    }

    for (const buttonLabel of clickableButtonLabels) {
      const buttons = screen.getAllByRole("button", { name: buttonLabel });
      expect(buttons.length).toBeGreaterThan(0);
      await user.click(buttons[0]!);
    }

    for (const inputLabel of expectedTextInputLabels) {
      const controls = screen.getAllByLabelText(inputLabel);
      expect(controls.length).toBeGreaterThan(0);
      const control = controls[0];
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        await user.clear(control);
        await user.type(control, "x");
      }
    }

    for (const selectLabel of expectedSelectLabels) {
      const selects = screen.getAllByRole("combobox", { name: selectLabel });
      expect(selects.length).toBeGreaterThan(0);
    }
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderScreen();
    const results = await axe(container, axeConfig);
    expect(results).toHaveNoViolations();
  });
});
`;

  return {
    path: testFilePath,
    content
  };
};

export const buildInlineLegacyFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
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
    normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
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
        const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
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

const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
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
};`;
};

export const buildLegacyFormContextFile = ({
  screenComponentName,
  initialValues,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialVisualErrorsMap,
  selectOptionsMap
}: {
  screenComponentName: string;
  initialValues: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialVisualErrorsMap: Record<string, string>;
  selectOptionsMap: Record<string, string[]>;
}): FormContextFileSpec => {
  const providerName = toFormContextProviderName(screenComponentName);
  const hookName = toFormContextHookName(screenComponentName);
  const contextVarName = `${screenComponentName}FormContext`;
  const contextValueTypeName = `${screenComponentName}FormContextValue`;
  const providerPropsTypeName = `${providerName}Props`;
  const contextSource = `/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";

export interface ${contextValueTypeName} {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  formValues: Record<string, string>;
  fieldErrors: Record<string, string>;
  touchedFields: Record<string, boolean>;
  updateFieldValue: (fieldKey: string, value: string) => void;
  handleFieldBlur: (fieldKey: string) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const ${contextVarName} = createContext<${contextValueTypeName} | undefined>(undefined);

export interface ${providerPropsTypeName} {
  children: ReactNode;
}

export function ${providerName}({ children }: ${providerPropsTypeName}) {
  const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
  const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
  const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
  const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
  const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};
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
      normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
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
          const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
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
  };

  return (
    <${contextVarName}.Provider
      value={{
        initialVisualErrors,
        selectOptions,
        formValues,
        fieldErrors,
        touchedFields,
        updateFieldValue,
        handleFieldBlur,
        handleSubmit
      }}
    >
      {children}
    </${contextVarName}.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${contextValueTypeName} => {
  const context = useContext(${contextVarName});
  if (!context) {
    throw new Error("${hookName} must be used within ${providerName}");
  }
  return context;
};
`;
  return {
    file: {
      path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}FormContext`)),
      content: contextSource
    },
    providerName,
    hookName,
    importPath: `../context/${screenComponentName}FormContext`
  };
};

export const toReactHookFormSchemaEntries = ({
  initialValues,
  indent
}: {
  initialValues: Record<string, string>;
  indent: string;
}): string => {
  const fieldKeys = Object.keys(initialValues).sort((left, right) => left.localeCompare(right));
  return fieldKeys.map((fieldKey) => `${indent}${literal(fieldKey)}: createFieldSchema({ fieldKey: ${literal(fieldKey)} })`).join(",\n");
};

export const buildInlineReactHookFormStateBlock = ({
  hasSelectField,
  selectOptionsMap,
  initialVisualErrorsMap,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialValues
}: {
  hasSelectField: boolean;
  selectOptionsMap: Record<string, string[]>;
  initialVisualErrorsMap: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialValues: Record<string, string>;
}): string => {
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "  "
  });
  return `${selectOptionsDeclaration}const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};

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
    normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const createFieldSchema = ({ fieldKey }: { fieldKey: string }) => {
  return z.string().superRefine((rawValue, issueContext) => {
    const trimmed = rawValue.trim();
    if (requiredFields[fieldKey] && trimmed.length === 0) {
      issueContext.addIssue({ code: z.ZodIssueCode.custom, message: "This field is required." });
      return;
    }
    if (trimmed.length === 0) {
      return;
    }

    const validationType = fieldValidationTypes[fieldKey];
    if (!validationType) {
      return;
    }
    const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

    switch (validationType) {
      case "email":
        if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      case "tel": {
        const compactTel = trimmed.replace(/\\s+/g, "");
        const digitCount = (compactTel.match(/\\d/g) ?? []).length;
        if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "url": {
        try {
          const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
          const parsed = new URL(normalizedUrl);
          if (!(parsed.hostname && parsed.hostname.includes("."))) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
        } catch {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      case "number":
        if (parseLocalizedNumber(trimmed) === undefined) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      case "date": {
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
        }
        const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
        if (![year, month, day].every((segment) => Number.isFinite(segment))) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          return;
        }
        const date = new Date(Date.UTC(year, month - 1, day));
        const isValidDate =
          date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
        if (!isValidDate) {
          issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
        }
        return;
      }
      default:
        return;
    }
  });
};

const formSchema = z.object({
${schemaEntries}
});

const { control, handleSubmit } = useForm({
  resolver: zodResolver(formSchema),
  defaultValues: ${JSON.stringify(initialValues, null, 2)}
});

const onSubmit = (values: Record<string, string>): void => {
  void values;
  // Intentionally no-op in deterministic fallback output.
};

const resolveFieldErrorMessage = ({
  fieldKey,
  isTouched,
  fieldError
}: {
  fieldKey: string;
  isTouched: boolean;
  fieldError: string | undefined;
}): string => {
  if (!isTouched) {
    return initialVisualErrors[fieldKey] ?? "";
  }
  return fieldError ?? "";
};`;
};

export const buildReactHookFormContextFile = ({
  screenComponentName,
  initialValues,
  requiredFieldMap,
  validationTypeMap,
  validationMessageMap,
  initialVisualErrorsMap,
  selectOptionsMap
}: {
  screenComponentName: string;
  initialValues: Record<string, string>;
  requiredFieldMap: Record<string, boolean>;
  validationTypeMap: Record<string, ValidationFieldType>;
  validationMessageMap: Record<string, string>;
  initialVisualErrorsMap: Record<string, string>;
  selectOptionsMap: Record<string, string[]>;
}): FormContextFileSpec => {
  const providerName = toFormContextProviderName(screenComponentName);
  const hookName = toFormContextHookName(screenComponentName);
  const contextVarName = `${screenComponentName}FormContext`;
  const contextValueTypeName = `${screenComponentName}FormContextValue`;
  const providerPropsTypeName = `${providerName}Props`;
  const schemaEntries = toReactHookFormSchemaEntries({
    initialValues,
    indent: "    "
  });
  const contextSource = `import { createContext, useContext, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export interface ${contextValueTypeName} {
  initialVisualErrors: Record<string, string>;
  selectOptions: Record<string, string[]>;
  control: UseFormReturn<Record<string, string>>["control"];
  handleSubmit: UseFormReturn<Record<string, string>>["handleSubmit"];
  onSubmit: (values: Record<string, string>) => void;
  resolveFieldErrorMessage: (input: { fieldKey: string; isTouched: boolean; fieldError: string | undefined }) => string;
}

const ${contextVarName} = createContext<${contextValueTypeName} | undefined>(undefined);

export interface ${providerPropsTypeName} {
  children: ReactNode;
}

export function ${providerName}({ children }: ${providerPropsTypeName}) {
  const initialVisualErrors: Record<string, string> = ${JSON.stringify(initialVisualErrorsMap, null, 2)};
  const requiredFields: Record<string, boolean> = ${JSON.stringify(requiredFieldMap, null, 2)};
  const fieldValidationTypes: Record<string, string> = ${JSON.stringify(validationTypeMap, null, 2)};
  const fieldValidationMessages: Record<string, string> = ${JSON.stringify(validationMessageMap, null, 2)};
  const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};

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
      normalized = integerPart.length > 0 ? integerPart + "." + fractionPart : "0." + fractionPart;
    } else {
      normalized = compact.replace(/[.,]/g, "");
    }
    if (!/^[+-]?\\d+(?:\\.\\d+)?$/.test(normalized)) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const createFieldSchema = ({ fieldKey }: { fieldKey: string }) => {
    return z.string().superRefine((rawValue, issueContext) => {
      const trimmed = rawValue.trim();
      if (requiredFields[fieldKey] && trimmed.length === 0) {
        issueContext.addIssue({ code: z.ZodIssueCode.custom, message: "This field is required." });
        return;
      }
      if (trimmed.length === 0) {
        return;
      }

      const validationType = fieldValidationTypes[fieldKey];
      if (!validationType) {
        return;
      }
      const validationMessage = fieldValidationMessages[fieldKey] ?? "Invalid value.";

      switch (validationType) {
        case "email":
          if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        case "tel": {
          const compactTel = trimmed.replace(/\\s+/g, "");
          const digitCount = (compactTel.match(/\\d/g) ?? []).length;
          if (!/^\\+?[0-9().-]{6,24}$/.test(compactTel) || digitCount < 6) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "url": {
          try {
            const normalizedUrl = /^[a-z]+:\\/\\//i.test(trimmed) ? trimmed : "https://" + trimmed;
            const parsed = new URL(normalizedUrl);
            if (!(parsed.hostname && parsed.hostname.includes("."))) {
              issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            }
          } catch {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        case "number":
          if (parseLocalizedNumber(trimmed) === undefined) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        case "date": {
          if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
          }
          const [year, month, day] = trimmed.split("-").map((segment) => Number.parseInt(segment, 10));
          if (![year, month, day].every((segment) => Number.isFinite(segment))) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
            return;
          }
          const date = new Date(Date.UTC(year, month - 1, day));
          const isValidDate =
            date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
          if (!isValidDate) {
            issueContext.addIssue({ code: z.ZodIssueCode.custom, message: validationMessage });
          }
          return;
        }
        default:
          return;
      }
    });
  };

  const formSchema = z.object({
${schemaEntries}
  });

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: ${JSON.stringify(initialValues, null, 2)}
  });

  const onSubmit = (values: Record<string, string>): void => {
    void values;
    // Intentionally no-op in deterministic fallback output.
  };

  const resolveFieldErrorMessage = ({
    fieldKey,
    isTouched,
    fieldError
  }: {
    fieldKey: string;
    isTouched: boolean;
    fieldError: string | undefined;
  }): string => {
    if (!isTouched) {
      return initialVisualErrors[fieldKey] ?? "";
    }
    return fieldError ?? "";
  };

  return (
    <${contextVarName}.Provider
      value={{
        initialVisualErrors,
        selectOptions,
        control: control as unknown as UseFormReturn<Record<string, string>>["control"],
        handleSubmit: handleSubmit as unknown as UseFormReturn<Record<string, string>>["handleSubmit"],
        onSubmit,
        resolveFieldErrorMessage
      }}
    >
      {children}
    </${contextVarName}.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${contextValueTypeName} => {
  const context = useContext(${contextVarName});
  if (!context) {
    throw new Error("${hookName} must be used within ${providerName}");
  }
  return context;
};
`;
  return {
    file: {
      path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}FormContext`)),
      content: contextSource
    },
    providerName,
    hookName,
    importPath: `../context/${screenComponentName}FormContext`
  };
};

export interface FallbackScreenFileInput {
  screen: ScreenIR;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  spacingBase?: number;
  tokens?: DesignTokens | undefined;
  iconResolver?: IconFallbackResolver;
  imageAssetMap?: Record<string, string>;
  routePathByScreenId?: Map<string, string>;
  generationLocale?: string;
  formHandlingMode?: WorkspaceFormHandlingMode;
  truncationMetric?: {
    originalElements: number;
    retainedElements: number;
    budget: number;
  };
  themeComponentDefaults?: ThemeComponentDefaults;
  componentNameOverride?: string;
  filePathOverride?: string;
  enablePatternExtraction?: boolean;
}

export interface PreparedFallbackScreenModel {
  screen: ScreenIR;
  componentName: string;
  filePath: string;
  truncationComment: string;
  resolvedSpacingBase: number;
  resolvedGenerationLocale: string;
  resolvedFormHandlingMode: ResolvedFormHandlingMode;
  resolvedThemeComponentDefaults: ThemeComponentDefaults | undefined;
  simplificationStats: SimplificationMetrics;
  simplifiedChildren: ScreenElementIR[];
  headingComponentByNodeId: Map<string, HeadingComponent>;
  typographyVariantByNodeId: Map<string, DesignTokenTypographyVariantName>;
  minX: number;
  minY: number;
  rootParent: VirtualParent;
  extractionPlan: PatternExtractionPlan;
  tokens?: DesignTokens;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  enablePatternExtraction: boolean;
}

export interface FallbackRenderState {
  renderContext: RenderContext;
  rendered: string;
  hasInteractiveFields: boolean;
  hasInteractiveAccordions: boolean;
  hasSelectField: boolean;
  hasTextInputField: boolean;
  containerMaxWidth: string;
  screenContainerSx: string;
}

export interface FallbackDependencyAssembly {
  formContextFileSpec?: FormContextFileSpec;
  patternContextFileSpec?: PatternContextFileSpec;
  patternContextInitialStateDeclaration: string;
  navigationHookBlock: string;
  stateBlock: string;
  containerFormProps: string;
  reactImportBlock: string;
  reactHookFormImport: string;
  zodImportBlock: string;
  reactRouterImport: string;
  selectChangeEventTypeImport: string;
  uniqueMuiImports: string[];
  iconImports: string;
  mappedImports: string;
  extractedComponentImports: string;
  patternContextImport: string;
  formContextImport: string;
}

export const prepareFallbackScreenModel = ({
  screen,
  mappingByNodeId,
  spacingBase,
  tokens,
  iconResolver = ICON_FALLBACK_BUILTIN_RESOLVER,
  imageAssetMap = {},
  routePathByScreenId = new Map<string, string>(),
  generationLocale,
  formHandlingMode,
  truncationMetric,
  themeComponentDefaults,
  componentNameOverride,
  filePathOverride,
  enablePatternExtraction = true
}: FallbackScreenFileInput): PreparedFallbackScreenModel => {
  const componentName = componentNameOverride ?? toComponentName(screen.name);
  const filePath = filePathOverride ?? toDeterministicScreenPath(screen.name);
  const truncationComment = toTruncationComment(truncationMetric);
  const resolvedSpacingBase = normalizeSpacingBase(spacingBase);
  const resolvedGenerationLocale = resolveGenerationLocale({
    requestedLocale: generationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  }).locale;
  const resolvedFormHandlingMode = resolveFormHandlingMode({
    requestedMode: formHandlingMode
  });
  const resolvedThemeComponentDefaults = themeComponentDefaults;
  const pageBackgroundColorNormalized = normalizeHexColor(screen.fillColor ?? tokens?.palette.background);

  const simplificationStats = createEmptySimplificationStats();
  const simplifiedChildren = simplifyElements({
    elements: screen.children,
    depth: 1,
    stats: simplificationStats
  });
  const headingComponentByNodeId = inferHeadingComponentByNodeId(simplifiedChildren);
  const typographyVariantByNodeId = resolveTypographyVariantByNodeId({
    elements: simplifiedChildren,
    tokens
  });
  const minX = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.x ?? 0)) : 0;
  const minY = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.y ?? 0)) : 0;
  const rootParent: VirtualParent = {
    x: minX,
    y: minY,
    width: screen.width,
    height: screen.height,
    name: screen.name,
    fillColor: screen.fillColor,
    fillGradient: screen.fillGradient,
    layoutMode: screen.layoutMode
  };
  const extractionPlan = buildPatternExtractionPlan({
    enablePatternExtraction,
    screen,
    screenComponentName: componentName,
    roots: simplifiedChildren,
    rootParent,
    generationLocale: resolvedGenerationLocale,
    spacingBase: resolvedSpacingBase,
    tokens,
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    ...(resolvedThemeComponentDefaults ? { themeComponentDefaults: resolvedThemeComponentDefaults } : {}),
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  });

  return {
    screen,
    componentName,
    filePath,
    truncationComment,
    resolvedSpacingBase,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    resolvedThemeComponentDefaults,
    simplificationStats,
    simplifiedChildren,
    headingComponentByNodeId,
    typographyVariantByNodeId,
    minX,
    minY,
    rootParent,
    extractionPlan,
    ...(tokens ? { tokens } : {}),
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    enablePatternExtraction
  };
};

export const buildFallbackRenderState = ({ prepared }: { prepared: PreparedFallbackScreenModel }): FallbackRenderState => {
  const {
    screen,
    headingComponentByNodeId,
    typographyVariantByNodeId,
    resolvedThemeComponentDefaults,
    simplifiedChildren,
    rootParent,
    minX,
    minY,
    iconResolver,
    imageAssetMap,
    routePathByScreenId,
    tokens,
    mappingByNodeId,
    pageBackgroundColorNormalized,
    extractionPlan
  } = prepared;
  const renderContext: RenderContext = {
    screenId: screen.id,
    screenName: screen.name,
    generationLocale: prepared.resolvedGenerationLocale,
    formHandlingMode: prepared.resolvedFormHandlingMode,
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
    spacingBase: prepared.resolvedSpacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized,
    ...(resolvedThemeComponentDefaults ? { themeComponentDefaults: resolvedThemeComponentDefaults } : {}),
    extractionInvocationByNodeId: extractionPlan.invocationByRootNodeId,
    ...(screen.responsive?.topLevelLayoutOverrides
      ? { responsiveTopLevelLayoutOverrides: screen.responsive.topLevelLayoutOverrides }
      : {})
  };

  const rendered = simplifiedChildren
    .map((element) =>
      renderElement(
        element,
        3,
        rootParent,
        renderContext
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
  const hasInteractiveFields = renderContext.fields.length > 0;
  const hasInteractiveAccordions = renderContext.accordions.length > 0;
  const hasSelectField = renderContext.fields.some((field) => field.isSelect);
  const hasTextInputField = renderContext.fields.some((field) => !field.isSelect);

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

  return {
    renderContext,
    rendered,
    hasInteractiveFields,
    hasInteractiveAccordions,
    hasSelectField,
    hasTextInputField,
    containerMaxWidth,
    screenContainerSx
  };
};

export const assembleFallbackDependencies = ({
  prepared,
  renderState
}: {
  prepared: PreparedFallbackScreenModel;
  renderState: FallbackRenderState;
}): FallbackDependencyAssembly => {
  const { componentName, extractionPlan, resolvedFormHandlingMode, enablePatternExtraction } = prepared;
  const {
    renderContext,
    rendered,
    hasInteractiveFields,
    hasInteractiveAccordions,
    hasSelectField,
    hasTextInputField
  } = renderState;

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

  const submitButtonDeclaration =
    renderContext.buttons.length > 0 ? `const primarySubmitButtonKey = ${literal(primarySubmitButtonKey)};` : "";
  const shouldGenerateFormContext = enablePatternExtraction && hasInteractiveFields;
  const usesReactHookForm = hasInteractiveFields && resolvedFormHandlingMode === "react_hook_form";
  const formContextFileSpec = shouldGenerateFormContext
    ? usesReactHookForm
      ? buildReactHookFormContextFile({
          screenComponentName: componentName,
          initialValues,
          requiredFieldMap,
          validationTypeMap,
          validationMessageMap,
          initialVisualErrorsMap,
          selectOptionsMap
        })
      : buildLegacyFormContextFile({
          screenComponentName: componentName,
          initialValues,
          requiredFieldMap,
          validationTypeMap,
          validationMessageMap,
          initialVisualErrorsMap,
          selectOptionsMap
        })
    : undefined;
  const formContextHookFields = usesReactHookForm
    ? [
        ...(hasSelectField ? ["selectOptions"] : []),
        "control",
        "handleSubmit",
        "onSubmit",
        "resolveFieldErrorMessage"
      ]
    : [
        "initialVisualErrors",
        ...(hasSelectField ? ["selectOptions"] : []),
        "formValues",
        "fieldErrors",
        "touchedFields",
        "updateFieldValue",
        "handleFieldBlur",
        "handleSubmit"
      ];
  const formContextHookBlock = formContextFileSpec
    ? `const { ${formContextHookFields.join(", ")} } = ${formContextFileSpec.hookName}();`
    : "";
  const inlineFieldStateBlock =
    !formContextFileSpec && hasInteractiveFields
      ? usesReactHookForm
        ? buildInlineReactHookFormStateBlock({
            hasSelectField,
            selectOptionsMap,
            initialVisualErrorsMap,
            requiredFieldMap,
            validationTypeMap,
            validationMessageMap,
            initialValues
          })
        : buildInlineLegacyFormStateBlock({
            hasSelectField,
            selectOptionsMap,
            initialVisualErrorsMap,
            requiredFieldMap,
            validationTypeMap,
            validationMessageMap,
            initialValues
          })
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

const ${tabChangeHandlerVar} = (_event: SyntheticEvent, newValue: number): void => {
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
  const stateBlock = [
    submitButtonDeclaration,
    formContextHookBlock,
    inlineFieldStateBlock,
    accordionStateBlock,
    tabsStateBlock,
    dialogsStateBlock
  ]
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
  const usesInlineLegacyFormState = !formContextFileSpec && hasInteractiveFields && !usesReactHookForm;
  const usesInlineReactHookForm = !formContextFileSpec && hasInteractiveFields && usesReactHookForm;
  const hasLocalStatefulElements =
    usesInlineLegacyFormState ||
    hasInteractiveAccordions ||
    renderContext.tabs.length > 0 ||
    renderContext.dialogs.length > 0;
  const formSubmitExpression =
    hasInteractiveFields && usesReactHookForm ? "handleSubmit(onSubmit)" : "handleSubmit";
  const containerFormProps = hasInteractiveFields ? ` component="form" onSubmit={${formSubmitExpression}} noValidate` : "";

  const reactValueImports = hasLocalStatefulElements ? ["useState"] : [];
  const reactTypeImports: string[] = [];
  if (usesInlineLegacyFormState) {
    reactTypeImports.push("FormEvent");
  }
  if (hasTextInputField) {
    reactTypeImports.push("ChangeEvent");
  }
  if (renderContext.usesNavigateHandler) {
    reactTypeImports.push("KeyboardEvent as ReactKeyboardEvent");
  }
  if (renderContext.tabs.length > 0) {
    reactTypeImports.push("SyntheticEvent");
  }
  const reactImportLines = [
    ...(reactValueImports.length > 0 ? [`import { ${reactValueImports.join(", ")} } from "react";`] : []),
    ...(reactTypeImports.length > 0 ? [`import type { ${reactTypeImports.join(", ")} } from "react";`] : [])
  ];
  const reactImportBlock = reactImportLines.length > 0 ? `${reactImportLines.join("\n")}\n` : "";
  const reactHookFormImport = usesReactHookForm
    ? `import { ${usesInlineReactHookForm ? "Controller, useForm" : "Controller"} } from "react-hook-form";\n`
    : "";
  const zodImportBlock = usesInlineReactHookForm
    ? 'import { zodResolver } from "@hookform/resolvers/zod";\nimport { z } from "zod";\n'
    : "";
  const selectChangeEventTypeImport = hasSelectField ? 'import type { SelectChangeEvent } from "@mui/material/Select";\n' : "";
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
  const extractedComponentImports = extractionPlan.componentImports
    .map((componentImport) => `import { ${componentImport.componentName} } from "${componentImport.importPath}";`)
    .join("\n");
  const patternContextFileSpec = extractionPlan.patternStatePlan.contextFileSpec;
  const patternContextImport = patternContextFileSpec
    ? `import { ${patternContextFileSpec.providerName}, type ${patternContextFileSpec.stateTypeName} } from "${patternContextFileSpec.importPath}";`
    : "";
  const formContextImport = formContextFileSpec
    ? `import { ${formContextFileSpec.providerName}, ${formContextFileSpec.hookName} } from "${formContextFileSpec.importPath}";`
    : "";
  const patternContextInitialStateDeclaration = patternContextFileSpec
    ? `const patternContextInitialState: ${patternContextFileSpec.stateTypeName} = ${patternContextFileSpec.initialStateLiteral};\n\n`
    : "";

  return {
    ...(formContextFileSpec ? { formContextFileSpec } : {}),
    ...(patternContextFileSpec ? { patternContextFileSpec } : {}),
    patternContextInitialStateDeclaration,
    navigationHookBlock,
    stateBlock,
    containerFormProps,
    reactImportBlock,
    reactHookFormImport,
    zodImportBlock,
    reactRouterImport,
    selectChangeEventTypeImport,
    uniqueMuiImports,
    iconImports,
    mappedImports,
    extractedComponentImports,
    patternContextImport,
    formContextImport
  };
};

export const composeFallbackScreenModule = ({
  prepared,
  renderState,
  dependencies
}: {
  prepared: PreparedFallbackScreenModel;
  renderState: FallbackRenderState;
  dependencies: FallbackDependencyAssembly;
}): FallbackScreenFileResult => {
  const { componentName, filePath, truncationComment, extractionPlan, simplifiedChildren, simplificationStats } = prepared;
  const { renderContext, rendered, containerMaxWidth, screenContainerSx } = renderState;
  const {
    formContextFileSpec,
    patternContextFileSpec,
    patternContextInitialStateDeclaration,
    navigationHookBlock,
    stateBlock,
    containerFormProps,
    reactImportBlock,
    reactHookFormImport,
    zodImportBlock,
    reactRouterImport,
    selectChangeEventTypeImport,
    uniqueMuiImports,
    iconImports,
    mappedImports,
    extractedComponentImports,
    patternContextImport,
    formContextImport
  } = dependencies;

  const contentFunctionName = `${componentName}ScreenContent`;
  const contentFunctionSource = `function ${contentFunctionName}() {
${[navigationHookBlock, stateBlock]
  .filter((chunk) => chunk.length > 0)
  .map((chunk) => `${indentBlock(chunk, 2)}\n`)
  .join("")}  return (
    <Container maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  const hasContextProviders = Boolean(patternContextFileSpec) || Boolean(formContextFileSpec);
  let wrappedScreenContent = `      <${contentFunctionName} />`;
  if (formContextFileSpec) {
    wrappedScreenContent = `      <${formContextFileSpec.providerName}>
${wrappedScreenContent}
      </${formContextFileSpec.providerName}>`;
  }
  if (patternContextFileSpec) {
    wrappedScreenContent = `      <${patternContextFileSpec.providerName} initialState={patternContextInitialState}>
${wrappedScreenContent}
      </${patternContextFileSpec.providerName}>`;
  }
  const screenExportSource = hasContextProviders
    ? `${contentFunctionSource}

export default function ${componentName}Screen() {
  return (
${wrappedScreenContent}
  );
}`
    : `export default function ${componentName}Screen() {
${[navigationHookBlock, stateBlock]
  .filter((chunk) => chunk.length > 0)
  .map((chunk) => `${indentBlock(chunk, 2)}\n`)
  .join("")}  return (
    <Container maxWidth="${containerMaxWidth}" role="main"${containerFormProps} sx={{ ${screenContainerSx} }}>
${rendered || '      <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
    </Container>
  );
}`;
  const screenContent = `${truncationComment}${reactImportBlock}${reactHookFormImport}${zodImportBlock}${reactRouterImport}${selectChangeEventTypeImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}${extractedComponentImports ? `${extractedComponentImports}\n` : ""}${patternContextImport ? `${patternContextImport}\n` : ""}${formContextImport ? `${formContextImport}\n` : ""}
${patternContextInitialStateDeclaration}${screenExportSource}
`;
  const sharedSxOptimizedScreenContent = extractSharedSxConstantsFromScreenContent(screenContent);
  const screenTestPlan = buildScreenTestTargetPlan({
    roots: simplifiedChildren,
    renderedOutput: rendered,
    buttons: renderContext.buttons,
    fields: renderContext.fields
  });
  const testFiles: GeneratedFile[] = [
    buildScreenUnitTestFile({
      componentName,
      screenFilePath: filePath,
      plan: screenTestPlan
    })
  ];
  const contextFiles: GeneratedFile[] = [
    ...extractionPlan.contextFiles,
    ...(formContextFileSpec ? [formContextFileSpec.file] : [])
  ];

  return {
    file: {
      path: filePath,
      content: sharedSxOptimizedScreenContent
    },
    prototypeNavigationRenderedCount: renderContext.prototypeNavigationRenderedCount,
    simplificationStats,
    usedMappingNodeIds: renderContext.usedMappingNodeIds,
    mappingWarnings: renderContext.mappingWarnings,
    accessibilityWarnings: renderContext.accessibilityWarnings,
    componentFiles: extractionPlan.componentFiles,
    contextFiles,
    testFiles
  };
};

export const fallbackScreenFile = (input: FallbackScreenFileInput): FallbackScreenFileResult => {
  const prepared = prepareFallbackScreenModel(input);
  const renderState = buildFallbackRenderState({ prepared });
  const dependencies = assembleFallbackDependencies({
    prepared,
    renderState
  });
  return composeFallbackScreenModule({
    prepared,
    renderState,
    dependencies
  });
};


export const makeErrorBoundaryFile = (): GeneratedFile => {
  return {
    path: "src/components/ErrorBoundary.tsx",
    content: `import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught:", error, info);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <Box role="alert" sx={{ display: "grid", minHeight: "50vh", placeItems: "center", px: 3 }}>
          <Stack spacing={2} sx={{ width: "100%", maxWidth: 420 }}>
            <Alert severity="error">Something went wrong while rendering this screen.</Alert>
            <Typography variant="body2" color="text.secondary">
              Try again or reload the page if the problem persists.
            </Typography>
            <Button onClick={this.handleRetry} variant="contained">
              Try again
            </Button>
          </Stack>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
`
  };
};

export const makeScreenSkeletonFile = (): GeneratedFile => {
  return {
    path: "src/components/ScreenSkeleton.tsx",
    content: `import { Box, Container, LinearProgress, Skeleton, Stack } from "@mui/material";

export default function ScreenSkeleton() {
  return (
    <Box
      component="section"
      role="status"
      aria-live="polite"
      aria-label="Loading screen content"
      aria-busy="true"
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        pt: 7,
        pb: 6
      }}
    >
      <LinearProgress
        aria-hidden
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1302
        }}
      />
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Skeleton variant="text" width="42%" height={52} />
          <Stack spacing={1.5}>
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="text" width="74%" />
            <Skeleton variant="text" width="68%" />
          </Stack>
          <Skeleton variant="rounded" height={220} />
          <Stack spacing={2} direction={{ xs: "column", md: "row" }}>
            <Skeleton variant="rounded" height={170} sx={{ flex: 1 }} />
            <Skeleton variant="rounded" height={170} sx={{ flex: 1 }} />
          </Stack>
          <Skeleton variant="rounded" height={120} />
        </Stack>
      </Container>
    </Box>
  );
}
`
  };
};

export const makeAppFile = ({
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
      return `          <Route path="${routePath}" element={<ErrorBoundary><${routeComponent} /></ErrorBoundary>} />`;
    })
    .join("\n");

  const firstScreen = screens.at(0);
  const firstIdentity = firstScreen ? identitiesByScreenId.get(firstScreen.id) : undefined;
  const firstRoute = firstIdentity?.routePath ?? (firstScreen ? `/${sanitizeFileName(firstScreen.name).toLowerCase()}` : "/");

  return `${reactImport}
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { ${routerComponentName}, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
${eagerImports}
${lazyImports.length > 0 ? `\n${lazyImports}` : ""}

const routeLoadingFallback = <ScreenSkeleton />;
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

