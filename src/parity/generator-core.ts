import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as ts from "typescript";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignIR,
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
import { isLlmClientError, type LlmClient } from "./llm.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";
import { WorkflowError } from "./workflow-error.js";

type TypeScriptRuntime = typeof ts;

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  llmClient?: LlmClient;
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
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE" | undefined;
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

const EGRESS_POLICY_DENY_MARKER = "egress policy denied";

const isEgressPolicyDenyError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (typeof current === "string") {
      if (current.toLowerCase().includes(EGRESS_POLICY_DENY_MARKER)) {
        return true;
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const typed = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typed.code === "E_EGRESS_POLICY_DENY") {
      return true;
    }
    if (typeof typed.message === "string" && typed.message.toLowerCase().includes(EGRESS_POLICY_DENY_MARKER)) {
      return true;
    }
    if (typed.cause !== undefined) {
      queue.push(typed.cause);
    }
  }

  return false;
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

const toRemLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rem = Math.round((value / REM_BASE) * 10000) / 10000;
  const remString = Number.isInteger(rem) ? String(rem) : rem.toString();
  return literal(`${remString}rem`);
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
    ["background.default", tokens.palette.background],
    ["text.primary", tokens.palette.text]
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
          element.padding.left > 0))
  );
};

const isIconLikeNode = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return loweredName.includes("muisvgiconroot") || loweredName.includes("iconcomponent") || loweredName.startsWith("ic_");
};

const isSemanticIconWrapper = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return loweredName.includes("buttonendicon") || loweredName.includes("expandiconwrapper");
};

const shouldPromoteChildren = (element: ScreenElementIR): boolean => {
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

  if (hasVectorPayload) {
    return simplified;
  }

  if (isSvgIconRoot || isSemanticIconWrapper(element)) {
    return simplified;
  }

  const hasChildren = simplifiedChildren.length > 0;
  if (!hasChildren && !hasVisualStyle(simplified) && !simplified.text?.trim()) {
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

const sortChildren = (children: ScreenElementIR[], layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE"): ScreenElementIR[] => {
  const copied = [...children];
  if (layoutMode === "HORIZONTAL") {
    copied.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  } else {
    copied.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  }
  return copied;
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
    [
      "pt",
      element.padding && element.padding.top > 0
        ? toSpacingUnitValue({ value: element.padding.top, spacingBase })
        : undefined
    ],
    [
      "pr",
      element.padding && element.padding.right > 0
        ? toSpacingUnitValue({ value: element.padding.right, spacingBase })
        : undefined
    ],
    [
      "pb",
      element.padding && element.padding.bottom > 0
        ? toSpacingUnitValue({ value: element.padding.bottom, spacingBase })
        : undefined
    ],
    [
      "pl",
      element.padding && element.padding.left > 0
        ? toSpacingUnitValue({ value: element.padding.left, spacingBase })
        : undefined
    ],
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
    ["borderRadius", element.cornerRadius ? toPxLiteral(element.cornerRadius) : undefined],
    [
      "boxShadow",
      toShadowSxEntry({
        elevation: element.elevation,
        insetShadow: element.insetShadow,
        preferInsetShadow
      })
    ],
    ["boxSizing", literal("border-box")],
    ["overflow", literal("visible")]
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
  const normalizedFont = normalizeFontFamily(element.fontFamily);
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
  const sx = sxString([
    ...textLayoutEntries,
    ["fontSize", element.fontSize ? toRemLiteral(element.fontSize) : undefined],
    ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
    ["fontFamily", normalizedFont ? literal(normalizedFont) : undefined],
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

  return `${indent}<Typography sx={{ ${sx} }}>{${text}}</Typography>`;
};

const firstText = (element: ScreenElementIR): string | undefined => {
  if (element.type === "text" && element.text?.trim()) {
    return element.text.trim();
  }
  for (const child of element.children ?? []) {
    const match = firstText(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const firstTextColor = (element: ScreenElementIR): string | undefined => {
  if (element.type === "text" && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstTextColor(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectVectorPaths = (element: ScreenElementIR): string[] => {
  const localPaths = Array.isArray(element.vectorPaths)
    ? element.vectorPaths.filter((path): path is string => typeof path === "string" && path.length > 0)
    : [];
  const nestedPaths = (element.children ?? []).flatMap((child) => collectVectorPaths(child));
  return [...new Set([...localPaths, ...nestedPaths])];
};

const firstVectorColor = (element: ScreenElementIR): string | undefined => {
  if (Array.isArray(element.vectorPaths) && element.vectorPaths.length > 0 && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstVectorColor(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectTextNodes = (element: ScreenElementIR): ScreenElementIR[] => {
  const local = element.type === "text" && element.text?.trim() ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectTextNodes(child));
  return [...local, ...nested];
};

const hasMeaningfulTextDescendants = (element: ScreenElementIR): boolean => {
  return collectTextNodes(element).some((node) => {
    const text = node.text?.trim() ?? "";
    if (!text) {
      return false;
    }
    return /[a-z0-9]/i.test(text);
  });
};

const collectIconNodes = (element: ScreenElementIR): ScreenElementIR[] => {
  const local = isIconLikeNode(element) ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectIconNodes(child));
  return [...local, ...nested];
};

const collectSubtreeNames = (element: ScreenElementIR): string[] => {
  return [element.name, ...(element.children ?? []).flatMap((child) => collectSubtreeNames(child))];
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

interface IconImportSpec {
  localName: string;
  modulePath: string;
}

interface MappedImportSpec {
  localName: string;
  modulePath: string;
}

interface RenderContext {
  fields: InteractiveFieldModel[];
  accordions: InteractiveAccordionModel[];
  muiImports: Set<string>;
  iconImports: IconImportSpec[];
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

const parseLocalizedNumber = (value: string): number | undefined => {
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatLocalizedNumber = (value: number, fractionDigits = 2): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(safe);
};

const deriveSelectOptions = (defaultValue: string): string[] => {
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
    const parsed = parseLocalizedNumber(trimmed);
    if (typeof parsed === "number") {
      const deltas = [-0.25, 0, 0.25];
      return [...new Set(deltas.map((delta) => `${formatLocalizedNumber(Math.max(0, parsed + delta))} %`))];
    }
  }

  const parsed = parseLocalizedNumber(trimmed);
  if (typeof parsed === "number") {
    const deltas = [-0.1, 0, 0.1];
    return [
      ...new Set(
        deltas.map((delta) => {
          const value = parsed * (1 + delta);
          return formatLocalizedNumber(Math.max(0, value));
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
const PLACEHOLDER_TEXT_PATTERNS = [
  /\beingabe\s*\d+\b/i,
  /\boption\s*\d+\b/i,
  /\blorem\b/i,
  /\bplaceholder\b/i,
  /\bfield\s*\d+\b/i
];

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

const FALLBACK_ICON_SPECS: Array<{ patterns: string[]; importSpec: IconImportSpec }> = [
  {
    patterns: ["bookmark", "merken"],
    importSpec: { localName: "BookmarkBorderIcon", modulePath: "@mui/icons-material/BookmarkBorder" }
  },
  {
    patterns: ["help", "hilfe", "questionmark"],
    importSpec: { localName: "HelpOutlineIcon", modulePath: "@mui/icons-material/HelpOutline" }
  },
  {
    patterns: ["homepage", "startseite", "house", "home"],
    importSpec: { localName: "HomeOutlinedIcon", modulePath: "@mui/icons-material/HomeOutlined" }
  },
  {
    patterns: ["personensuche", "person_search", "search_person", "person search"],
    importSpec: { localName: "PersonSearchIcon", modulePath: "@mui/icons-material/PersonSearch" }
  },
  {
    patterns: ["messenger", "speechbubble", "speech_bubble", "chat", "forum"],
    importSpec: { localName: "ForumOutlinedIcon", modulePath: "@mui/icons-material/ForumOutlined" }
  },
  {
    patterns: ["folder", "document", "two_documents"],
    importSpec: { localName: "FolderOutlinedIcon", modulePath: "@mui/icons-material/FolderOutlined" }
  },
  {
    patterns: ["edit", "pencil"],
    importSpec: { localName: "EditOutlinedIcon", modulePath: "@mui/icons-material/EditOutlined" }
  },
  {
    patterns: ["delete", "trash"],
    importSpec: { localName: "DeleteOutlineIcon", modulePath: "@mui/icons-material/DeleteOutline" }
  },
  {
    patterns: ["mail", "postbox"],
    importSpec: { localName: "MailOutlineIcon", modulePath: "@mui/icons-material/MailOutline" }
  },
  {
    patterns: ["add", "plus"],
    importSpec: { localName: "AddIcon", modulePath: "@mui/icons-material/Add" }
  },
  {
    patterns: ["search", "magnifier"],
    importSpec: { localName: "SearchIcon", modulePath: "@mui/icons-material/Search" }
  },
  {
    patterns: ["info", "hint"],
    importSpec: { localName: "InfoOutlinedIcon", modulePath: "@mui/icons-material/InfoOutlined" }
  }
];

const hasDownIndicatorHint = (subtreeNameBlob: string): boolean => {
  return (
    subtreeNameBlob.includes("expand_more") ||
    subtreeNameBlob.includes("chevron_down") ||
    subtreeNameBlob.includes("arrow_drop_down") ||
    subtreeNameBlob.includes("keyboard_arrow_down") ||
    subtreeNameBlob.includes("caret_down") ||
    subtreeNameBlob.includes("ic_down") ||
    /\bdown\b/.test(subtreeNameBlob)
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
  const subtreeNameBlob = collectSubtreeNames(element).join(" ").toLowerCase();

  const spec =
    parentName.includes("buttonendicon") || subtreeNameBlob.includes("chevron_right") || subtreeNameBlob.includes("arrow_right")
      ? {
          localName: "ChevronRightIcon",
          modulePath: "@mui/icons-material/ChevronRight"
        }
      : parentName.includes("expandiconwrapper") ||
          parentName.includes("outlinedinputroot") ||
          parentName.includes("formcontrolroot") ||
          parentName.includes("select") ||
          hasDownIndicatorHint(subtreeNameBlob)
        ? {
            localName: "ExpandMoreIcon",
            modulePath: "@mui/icons-material/ExpandMore"
          }
        : parentName.includes("accordionsummarycontent")
          ? {
              localName: "TuneIcon",
              modulePath: "@mui/icons-material/Tune"
            }
          : FALLBACK_ICON_SPECS.find(({ patterns }) => patterns.some((pattern) => subtreeNameBlob.includes(pattern)))?.importSpec ?? {
              localName: "InfoOutlinedIcon",
              modulePath: "@mui/icons-material/InfoOutlined"
            };

  return registerIconImport(context, spec);
};

const renderFallbackIconExpression = ({
  element,
  parent,
  context,
  extraEntries = []
}: {
  element: ScreenElementIR;
  parent: Pick<VirtualParent, "name">;
  context: RenderContext;
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
  return `<${iconComponent} sx={{ ${sx} }} fontSize="inherit" />`;
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

  const label = model.labelNode?.text?.trim() ?? element.name;
  const placeholder = model.placeholderNode?.text?.trim();
  const defaultValue = model.valueNode?.text?.trim() ?? "";
  const isSelect = model.isSelect;
  const options = isSelect ? deriveSelectOptions(defaultValue) : [];

  const created: InteractiveFieldModel = {
    key,
    label,
    defaultValue,
    ...(placeholder && !isSelect ? { placeholder } : {}),
    isSelect,
    options,
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
  extraEntries = []
}: {
  icon: SemanticIconModel;
  context: RenderContext;
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
  return `<SvgIcon sx={{ ${sx} }} viewBox={${literal(`0 0 ${width} ${height}`)}}>${paths}</SvgIcon>`;
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
    ["borderRadius", toPxLiteral(outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius)],
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

  if (field.isSelect) {
    registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem");
    const selectLabelId = `${field.key}-label`;
    return `${indent}<FormControl sx={{ ${fieldSx} }}>
${indent}  <InputLabel id={${literal(selectLabelId)}} sx={{ ${inputLabelStyle} }}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(selectLabelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
${indent}    sx={{
${indent}      ${inputRootStyle},
${indent}      "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} }
${indent}    }}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
${indent}</FormControl>`;
  }

  registerMuiImports(context, "TextField");
  if (field.suffixText) {
    registerMuiImports(context, "InputAdornment");
  }
  const placeholderProp = field.placeholder ? `${indent}  placeholder={${literal(field.placeholder)}}\n` : "";
  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${placeholderProp}${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  sx={{
${indent}    ${fieldSx},
${indent}    "& .MuiOutlinedInput-root": { ${inputRootStyle} },
${indent}    "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} },
${indent}    "& .MuiInputLabel-root": { ${inputLabelStyle} }
${indent}  }}
${indent}  InputProps={{ ${endAdornment} }}
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

  const summaryChildren = sortChildren(summaryContent.children ?? [], summaryContent.layoutMode ?? "NONE");
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

  const detailChildren = sortChildren(detailsContainer.children ?? [], detailsContainer.layoutMode ?? "NONE");
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
    [
      "pt",
      detailsContainer.padding && detailsContainer.padding.top > 0
        ? toSpacingUnitValue({ value: detailsContainer.padding.top, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pr",
      detailsContainer.padding && detailsContainer.padding.right > 0
        ? toSpacingUnitValue({ value: detailsContainer.padding.right, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pb",
      detailsContainer.padding && detailsContainer.padding.bottom > 0
        ? toSpacingUnitValue({ value: detailsContainer.padding.bottom, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pl",
      detailsContainer.padding && detailsContainer.padding.left > 0
        ? toSpacingUnitValue({ value: detailsContainer.padding.left, spacingBase: context.spacingBase })
        : undefined
    ]
  ]);

  const summarySx = sxString([
    ["minHeight", toPxLiteral(summaryRoot.height)],
    [
      "pt",
      summaryRoot.padding && summaryRoot.padding.top > 0
        ? toSpacingUnitValue({ value: summaryRoot.padding.top, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pr",
      summaryRoot.padding && summaryRoot.padding.right > 0
        ? toSpacingUnitValue({ value: summaryRoot.padding.right, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pb",
      summaryRoot.padding && summaryRoot.padding.bottom > 0
        ? toSpacingUnitValue({ value: summaryRoot.padding.bottom, spacingBase: context.spacingBase })
        : undefined
    ],
    [
      "pl",
      summaryRoot.padding && summaryRoot.padding.left > 0
        ? toSpacingUnitValue({ value: summaryRoot.padding.left, spacingBase: context.spacingBase })
        : undefined
    ]
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

const renderButton = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "Button");
  const indent = "  ".repeat(depth);
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
      extraEntries: [["fontSize", literal("inherit")]]
    });
    const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
    return `${indent}<IconButton aria-label=${literal(element.name)}${disabledProp} sx={{ ${iconButtonSxWithState} }}>${iconExpression}</IconButton>`;
  }

  const iconExpression = iconNode
    ? renderFallbackIconExpression({
        element: iconNode,
        parent: { name: endIconRoot?.name ?? element.name },
        context,
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
    ["fontSize", element.fontSize ? toRemLiteral(element.fontSize) : undefined],
    ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", element.lineHeight ? toRemLiteral(element.lineHeight) : undefined],
    ["color", toThemeColorLiteral({ color: buttonTextColor, tokens: context.tokens })],
    ["textTransform", literal("none")],
    ["justifyContent", literal("center")]
  ]);

  const sxWithVariantStates = appendVariantStateOverridesToSx({
    sx,
    element,
    tokens: context.tokens
  });
  const variant = mappedMuiProps?.variant ?? (element.fillColor || element.fillGradient ? "contained" : "outlined");
  const sizeProp = mappedMuiProps?.size ? ` size="${mappedMuiProps.size}"` : "";
  const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
  const startIconProp = iconExpression && !iconBelongsAtEnd ? ` startIcon={${iconExpression}}` : "";
  const endIconProp = iconExpression && iconBelongsAtEnd ? ` endIcon={${iconExpression}}` : "";

  return `${indent}<Button variant="${variant}"${sizeProp}${disabledProp} disableElevation${startIconProp}${endIconProp} sx={{ ${sxWithVariantStates} }}>{${literal(label ?? element.name)}}</Button>`;
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
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE");
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
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
};

interface RenderedItem {
  id: string;
  label: string;
  node: ScreenElementIR;
}

const collectRenderedItems = (element: ScreenElementIR): RenderedItem[] => {
  return sortChildren(element.children ?? [], element.layoutMode ?? "NONE")
    .map((child, index) => ({
      id: child.id || `${element.id}-item-${index + 1}`,
      label: firstText(child)?.trim() || child.name || `Item ${index + 1}`,
      node: child
    }))
    .filter((entry) => entry.label.trim().length > 0);
};

const collectRenderedItemLabels = (element: ScreenElementIR): Array<{ id: string; label: string }> => {
  return collectRenderedItems(element).map((item) => ({
    id: item.id,
    label: item.label
  }));
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
  const elevationProp = typeof cardElevation === "number" && cardElevation > 0 ? ` elevation={${cardElevation}}` : "";
  const sortedChildren = sortChildren(element.children ?? [], element.layoutMode ?? "NONE");
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
        ["background", mediaCandidate.fillGradient ? literal(mediaCandidate.fillGradient) : undefined],
        [
          "bgcolor",
          !mediaCandidate.fillGradient
            ? toThemeColorLiteral({ color: mediaCandidate.fillColor, tokens: context.tokens })
            : undefined
        ]
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
  const mediaBlock = mediaCandidate ? `${indent}  <CardMedia sx={{ ${mediaSx} }} />\n` : "";
  const actionsBlock = renderedActions.trim() ? `\n${indent}  <CardActions>\n${renderedActions}\n${indent}  </CardActions>` : "";
  return `${indent}<Card${elevationProp} sx={{ ${sx} }}>
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
  const variantProp = chipVariant ? ` variant="${chipVariant}"` : "";
  const sizeProp = chipSize ? ` size="${chipSize}"` : "";
  const disabledProp = mappedMuiProps?.disabled ? " disabled" : "";
  return `${indent}<Chip label={${literal(label)}}${variantProp}${sizeProp}${disabledProp} sx={{ ${sx} }} />`;
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
    const options = collectRenderedItems(element);
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
  const items = collectRenderedItems(element);
  if (items.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "List", "ListItem", "ListItemText");
  const hasListIcons = items.some((item) => Boolean(pickBestIconNode(item.node)));
  if (hasListIcons) {
    registerMuiImports(context, "ListItemIcon");
  }
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedItems = items
    .map((item) => {
      const iconNode = pickBestIconNode(item.node);
      const iconBlock = iconNode
        ? `<ListItemIcon>${renderFallbackIconExpression({
            element: iconNode,
            parent: { name: item.node.name },
            context
          })}</ListItemIcon>`
        : "";
      return `${indent}  <ListItem key={${literal(item.id)}} disablePadding>${iconBlock}<ListItemText primary={${literal(item.label)}} /></ListItem>`;
    })
    .join("\n");
  return `${indent}<List sx={{ ${sx} }}>
${renderedItems}
${indent}</List>`;
};

const renderAppBar = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string => {
  registerMuiImports(context, "AppBar", "Toolbar", "Typography");
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
  const fallbackTitle = firstText(element)?.trim() || element.name || "App";
  return `${indent}<AppBar position="static" sx={{ ${sx} }}>
${indent}  <Toolbar>
${renderedChildren || `${indent}    <Typography variant="h6">{${literal(fallbackTitle)}}</Typography>`}
${indent}  </Toolbar>
${indent}</AppBar>`;
};

const renderTabs = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const tabs = collectRenderedItemLabels(element);
  if (tabs.length === 0) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Tabs", "Tab");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const renderedTabs = tabs.map((tab, index) => `${indent}  <Tab key={${literal(tab.id)}} value={${index}} label={${literal(tab.label)}} />`).join("\n");
  return `${indent}<Tabs value={0} sx={{ ${sx} }}>
${renderedTabs}
${indent}</Tabs>`;
};

const renderDialog = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
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
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context
  });
  const contentBlock = renderedChildren.trim()
    ? `${indent}  <DialogContent>\n${renderedChildren}\n${indent}  </DialogContent>`
    : `${indent}  <DialogContent />`;
  return `${indent}<Dialog open sx={{ "& .MuiDialog-paper": { ${sx} } }}>
${title ? `${indent}  <DialogTitle>{${literal(title)}}</DialogTitle>\n` : ""}${contentBlock}
${indent}</Dialog>`;
};

const renderStepper = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const steps = collectRenderedItemLabels(element);
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
  return `${indent}<Divider sx={{ ${sx} }} />`;
};

const renderNavigation = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const actions = collectRenderedItemLabels(element);
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
    .map(
      (action, index) =>
        `${indent}  <BottomNavigationAction key={${literal(action.id)}} value={${index}} label={${literal(action.label)}} />`
    )
    .join("\n");
  return `${indent}<BottomNavigation showLabels value={0} sx={{ ${sx} }}>
${renderedActions}
${indent}</BottomNavigation>`;
};

const renderGrid = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const items = collectRenderedItems(element);
  if (items.length < 2) {
    return renderContainer(element, depth, parent, context);
  }
  registerMuiImports(context, "Grid");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const totalChildWidth = items.reduce((total, item) => total + Math.max(1, item.node.width ?? 0), 0);
  const renderedItems = items
    .map((item) => {
      const widthRatio = Math.max(1, item.node.width ?? 0) / Math.max(1, totalChildWidth);
      const mdSize = clamp(Math.round(widthRatio * 12), 2, 12);
      const childContent = renderElement(
        item.node,
        depth + 2,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          name: element.name,
          layoutMode: element.layoutMode ?? "NONE"
        },
        context
      );
      return `${indent}  <Grid key={${literal(item.id)}} size={{ xs: 12, md: ${mdSize} }}>
${childContent ?? `${indent}    <Box />`}
${indent}  </Grid>`;
    })
    .join("\n");
  return `${indent}<Grid container spacing={2} sx={{ ${sx} }}>
${renderedItems}
${indent}</Grid>`;
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
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  if (!renderedChildren.trim()) {
    return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}} sx={{ ${sx} }} />`;
  }
  return `${indent}<Stack direction=${literal(direction)} spacing={${spacing}} sx={{ ${sx} }}>
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
  const renderedChildren = renderChildrenIntoParent({
    element,
    depth: depth + 1,
    context
  });
  const elevationProp = typeof elevation === "number" && elevation > 0 ? ` elevation={${elevation}}` : "";
  const variantProp = variant ? ` variant="${variant}"` : "";
  if (!renderedChildren.trim()) {
    return `${indent}<Paper${elevationProp}${variantProp} sx={{ ${sx} }} />`;
  }
  return `${indent}<Paper${elevationProp}${variantProp} sx={{ ${sx} }}>
${renderedChildren}
${indent}</Paper>`;
};

const renderTable = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const rows = sortChildren(element.children ?? [], element.layoutMode ?? "VERTICAL")
    .map((row) => {
      const rowChildren = sortChildren(row.children ?? [], row.layoutMode ?? "HORIZONTAL");
      if (rowChildren.length === 0) {
        return [row];
      }
      return rowChildren;
    })
    .filter((row) => row.length > 0);
  if (rows.length < 2 || rows.some((row) => row.length < 2)) {
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
  const anchorNode = sortChildren(element.children ?? [], element.layoutMode ?? "NONE")[0];
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
  return `${indent}<Drawer open variant="persistent" sx={{ "& .MuiDrawer-paper": { ${sx} } }}>
${indent}  <Box sx={{ width: "100%" }}>
${renderedChildren || `${indent}    <Box />`}
${indent}  </Box>
${indent}</Drawer>`;
};

const renderBreadcrumbs = (element: ScreenElementIR, depth: number, parent: VirtualParent, context: RenderContext): string | null => {
  const crumbs = collectRenderedItemLabels(element);
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
  const optionsFromChildren = collectRenderedItems(element)
    .map((item) => sanitizeSelectOptionValue(item.label))
    .filter((value) => value.length > 0);
  const fallbackDefault = sanitizeSelectOptionValue(firstText(element)?.trim() || "Option 1");
  const options = optionsFromChildren.length > 0 ? [...new Set(optionsFromChildren)] : deriveSelectOptions(fallbackDefault);
  const field: InteractiveFieldModel =
    existing ??
    (() => {
      const created: InteractiveFieldModel = {
        key,
        label: firstText(element)?.trim() || element.name,
        defaultValue: options[0] ?? fallbackDefault,
        isSelect: true,
        options
      };
      context.fields.push(created);
      return created;
    })();
  registerMuiImports(context, "FormControl", "InputLabel", "Select", "MenuItem");
  const indent = "  ".repeat(depth);
  const sx = toElementSx({
    element,
    parent,
    context,
    includePaints: false
  });
  const labelId = `${field.key}-label`;
  return `${indent}<FormControl sx={{ ${sx} }}>
${indent}  <InputLabel id={${literal(labelId)}}>{${literal(field.label)}}</InputLabel>
${indent}  <Select
${indent}    labelId={${literal(labelId)}}
${indent}    label={${literal(field.label)}}
${indent}    value={formValues[${literal(field.key)}] ?? ""}
${indent}    onChange={(event) => updateFieldValue(${literal(field.key)}, String(event.target.value))}
${indent}  >
${indent}    {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}      <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}    ))}
${indent}  </Select>
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
  return `${indent}<Skeleton variant="${variant}" sx={{ ${sx} }} />`;
};

const renderContainer = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  registerMuiImports(context, "Box");
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

  if ((isIconLikeNode(element) || isSemanticIconWrapper(element)) && !hasMeaningfulTextDescendants(element)) {
    const iconExpression = renderFallbackIconExpression({
      element,
      parent,
      context,
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

  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE");

  const renderedChildren = children
    .map((child) => renderElement(child, depth + 1, {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      name: element.name,
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
    return `${indent}<Divider sx={{ ${sx} }} />`;
  }

  const sx = toElementSx({
    element,
    parent,
    context
  });

  if (!renderedChildren.trim()) {
    if (!hasVisualStyle(element)) {
      return null;
    }
    return `${indent}<Box sx={{ ${sx} }} />`;
  }

  return `${indent}<Box sx={{ ${sx} }}>
${renderedChildren}
${indent}</Box>`;
};

const renderElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const mappedElement = renderMappedElement(element, depth, parent, context);
  if (mappedElement) {
    return mappedElement;
  }

  if (element.nodeType === "VECTOR") {
    return null;
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
    case "container":
    default:
      return renderContainer(element, depth, parent, context);
  }
};

const fallbackThemeFile = (ir: DesignIR): GeneratedFile => {
  const tokens = ir.tokens;
  return {
    path: "src/theme/theme.ts",
    content: `import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "${tokens.palette.primary}" },
    secondary: { main: "${tokens.palette.secondary}" },
    background: { default: "${tokens.palette.background}", paper: "${tokens.palette.background}" },
    text: { primary: "${tokens.palette.text}" }
  },
  shape: {
    borderRadius: ${Math.max(0, Math.round(tokens.borderRadius))}
  },
  spacing: ${Math.max(1, Math.round(tokens.spacingBase))},
  typography: {
    fontFamily: "${tokens.fontFamily}",
    h1: { fontSize: ${Math.max(1, Math.round(tokens.headingSize))} },
    body1: { fontSize: ${Math.max(1, Math.round(tokens.bodySize))} }
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
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
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
  truncationMetric,
  componentNameOverride,
  filePathOverride
}: {
  screen: ScreenIR;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  spacingBase?: number;
  tokens?: DesignTokens | undefined;
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

  const simplifiedChildren = simplifyElements(screen.children);
  const minX = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.x ?? 0)) : 0;
  const minY = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.y ?? 0)) : 0;
  const renderContext: RenderContext = {
    fields: [],
    accordions: [],
    muiImports: new Set<string>(["Box", "Container"]),
    iconImports: [],
    mappedImports: [],
    spacingBase: resolvedSpacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
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
  const contentRootSx = sxString([
    ["position", literal("relative")],
    ["width", literal("100%")],
    ["minHeight", literal(`${contentHeight}px`)],
    ...toScreenResponsiveRootMediaEntries({
      screen,
      spacingBase: renderContext.spacingBase
    })
  ]);
  const containerMaxWidth = toMuiContainerMaxWidth(contentWidth);
  const screenRootSx = sxString([
    ["minHeight", literal("100vh")],
    ["background", screen.fillGradient ? literal(screen.fillGradient) : undefined],
    [
      "bgcolor",
      !screen.fillGradient
        ? toThemeColorLiteral({ color: screen.fillColor ?? "background.default", tokens: renderContext.tokens })
        : undefined
    ],
    ["display", literal("block")],
    ["px", 0],
    ["py", 0]
  ]);
  const containerPadding = toSpacingUnitValue({ value: 16, spacingBase: renderContext.spacingBase }) ?? 2;

  const initialValues = Object.fromEntries(renderContext.fields.map((field) => [field.key, field.defaultValue]));
  const selectOptionsMap = Object.fromEntries(
    renderContext.fields.filter((field) => field.isSelect).map((field) => [field.key, field.options])
  );
  const initialAccordionState = Object.fromEntries(
    renderContext.accordions.map((accordion) => [accordion.key, accordion.defaultExpanded])
  );
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";

  const fieldStateBlock = hasInteractiveFields
    ? `const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});

${selectOptionsDeclaration}const updateFieldValue = (fieldKey: string, value: string): void => {
  setFormValues((previous) => ({ ...previous, [fieldKey]: value }));
};`
    : "";
  const accordionStateBlock = hasInteractiveAccordions
    ? `const [accordionState, setAccordionState] = useState<Record<string, boolean>>(${JSON.stringify(initialAccordionState, null, 2)});

const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
  setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
};`
    : "";
  const stateBlock = [fieldStateBlock, accordionStateBlock].filter((chunk) => chunk.length > 0).join("\n\n");
  const hasStatefulElements = hasInteractiveFields || hasInteractiveAccordions;

  const reactImport = hasStatefulElements ? 'import { useState } from "react";\n' : "";
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
      content: `${truncationComment}${reactImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}

export default function ${componentName}Screen() {
${stateBlock ? `${indentBlock(stateBlock, 2)}\n` : ""}
  return (
    <Box sx={{ ${screenRootSx} }}>
      <Container maxWidth="${containerMaxWidth}" sx={{ width: "100%", px: ${containerPadding}, boxSizing: "border-box", py: ${containerPadding} }}>
        <Box sx={{ ${contentRootSx} }}>
${rendered || '        <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
        </Box>
      </Container>
    </Box>
  );
}
`
    },
    usedMappingNodeIds: renderContext.usedMappingNodeIds,
    mappingWarnings: renderContext.mappingWarnings
  };
};

export const toDeterministicScreenPath = (screenName: string): string => {
  return path.posix.join("src", "screens", ensureTsxName(screenName));
};

export const createDeterministicThemeFile = (ir: DesignIR): GeneratedFile => {
  return fallbackThemeFile(ir);
};

export const createDeterministicScreenFile = (screen: ScreenIR): GeneratedFile => {
  return fallbackScreenFile({
    screen,
    mappingByNodeId: new Map<string, ComponentMappingRule>(),
    spacingBase: DEFAULT_SPACING_BASE
  }).file;
};

export const createDeterministicAppFile = (screens: ScreenIR[]): GeneratedFile => {
  const identitiesByScreenId = buildScreenArtifactIdentities(screens);
  return {
    path: "src/App.tsx",
    content: makeAppFile({
      screens,
      identitiesByScreenId
    })
  };
};

const makeAppFile = ({
  screens,
  identitiesByScreenId = buildScreenArtifactIdentities(screens)
}: {
  screens: ScreenIR[];
  identitiesByScreenId?: Map<string, ScreenArtifactIdentity>;
}): string => {
  const lazyScreens = screens.slice(1);
  const hasLazyRoutes = lazyScreens.length > 0;
  const reactImport = hasLazyRoutes ? 'import { Suspense, lazy } from "react";' : 'import { Suspense } from "react";';

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
import { Box, CircularProgress } from "@mui/material";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
${eagerImports}
${lazyImports.length > 0 ? `\n${lazyImports}` : ""}

const routeLoadingFallback = (
  <Box sx={{ display: "grid", minHeight: "50vh", placeItems: "center" }}>
    <CircularProgress size={32} />
  </Box>
);

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
${routes}
          <Route path="/" element={<Navigate to="${firstRoute}" replace />} />
          <Route path="*" element={<Navigate to="${firstRoute}" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
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

interface ScreenInteractivityExpectation {
  inputCount: number;
  selectCount: number;
  accordionCount: number;
}

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

const normalizeSemanticText = (rawValue: string): string => {
  return rawValue
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß€%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isLikelySemanticLabel = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 56) {
    return false;
  }
  if (!/[A-Za-zÄÖÜäöüß]/.test(trimmed)) {
    return false;
  }
  if (/^\d+(?:[.,]\d+)*(?:\s?(?:€|%|p\.a\.))?$/i.test(trimmed)) {
    return false;
  }
  if (trimmed.split(/\s+/).length > 7) {
    return false;
  }
  return true;
};

const collectSemanticLabelCandidates = (screen: ScreenIR): string[] => {
  const orderedTextNodes = flattenElements(screen.children)
    .filter((node) => node.type === "text" && typeof node.text === "string" && isLikelySemanticLabel(node.text))
    .map((node) => ({
      label: normalizeSemanticText(node.text ?? ""),
      y: node.y ?? Number.MAX_SAFE_INTEGER,
      x: node.x ?? Number.MAX_SAFE_INTEGER
    }))
    .filter((entry) => entry.label.length > 0)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const uniqueLabels: string[] = [];
  for (const entry of orderedTextNodes) {
    if (uniqueLabels.includes(entry.label)) {
      continue;
    }
    uniqueLabels.push(entry.label);
    if (uniqueLabels.length >= 24) {
      break;
    }
  }

  return uniqueLabels;
};

const collectLiteralLabelCandidates = (screen: ScreenIR): string[] => {
  const orderedTextNodes = flattenElements(screen.children)
    .filter((node) => node.type === "text" && typeof node.text === "string" && isLikelySemanticLabel(node.text))
    .map((node) => ({
      label: node.text?.trim() ?? "",
      y: node.y ?? Number.MAX_SAFE_INTEGER,
      x: node.x ?? Number.MAX_SAFE_INTEGER
    }))
    .filter((entry) => entry.label.length > 0)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const uniqueLabels: string[] = [];
  for (const entry of orderedTextNodes) {
    if (uniqueLabels.includes(entry.label)) {
      continue;
    }
    uniqueLabels.push(entry.label);
    if (uniqueLabels.length >= 24) {
      break;
    }
  }

  return uniqueLabels;
};

const collectPlaceholderMatches = (content: string): string[] => {
  const uniqueMatches = new Set<string>();
  for (const pattern of PLACEHOLDER_TEXT_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    match = globalPattern.exec(content);
    while (match) {
      const normalized = normalizeSemanticText(match[0]);
      if (normalized.length > 0) {
        uniqueMatches.add(normalized);
      }
      match = globalPattern.exec(content);
    }
  }
  return Array.from(uniqueMatches);
};

const resolveLabelCoverageThreshold = (expectedCount: number): number => {
  if (expectedCount <= 4) {
    return 0.85;
  }
  if (expectedCount <= 8) {
    return 0.75;
  }
  if (expectedCount <= 16) {
    return 0.65;
  }
  return 0.55;
};

const collectSelectOptionLiterals = (source: string): string[] => {
  const unique = new Set<string>();
  const selectOptionsMatch = source.match(/const\s+selectOptions\s*:\s*Record<string,\s*string\[]>\s*=\s*({[\s\S]*?});/);
  if (selectOptionsMatch?.[1]) {
    try {
      const parsed = JSON.parse(selectOptionsMatch[1]) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (!Array.isArray(value)) {
          continue;
        }
        for (const entry of value) {
          if (typeof entry !== "string") {
            continue;
          }
          const trimmed = entry.trim();
          if (trimmed.length > 0) {
            unique.add(trimmed);
          }
        }
      }
    } catch {
      // Ignore parse failures and continue with fallback extraction.
    }
  }

  const menuItemRegex = /<MenuItem[^>]*>\s*([^<\n][^<]*?)\s*<\/MenuItem>/g;
  let menuItemMatch = menuItemRegex.exec(source);
  while (menuItemMatch) {
    const capturedValue = menuItemMatch[1];
    if (!capturedValue) {
      menuItemMatch = menuItemRegex.exec(source);
      continue;
    }
    const value = capturedValue.trim();
    if (value.length > 0 && !value.includes("{")) {
      unique.add(value);
    }
    menuItemMatch = menuItemRegex.exec(source);
  }

  return Array.from(unique).slice(0, 24);
};

const validateSemanticFidelity = ({
  screen,
  generatedContent,
  baselineContent,
  requiredLabelSet
}: {
  screen: ScreenIR;
  generatedContent: string;
  baselineContent: string;
  requiredLabelSet?: string[];
}): { isValid: boolean; reason?: string } => {
  const expectedLabels = collectSemanticLabelCandidates(screen);
  const requiredLabels = (requiredLabelSet ?? [])
    .map((value) => normalizeSemanticText(value))
    .filter((value) => value.length > 0 && !expectedLabels.includes(value));
  const requiredFirstLabels = [...requiredLabels, ...expectedLabels];
  const uniqueExpectedLabels = requiredFirstLabels.filter((value, index) => requiredFirstLabels.indexOf(value) === index);
  if (uniqueExpectedLabels.length === 0) {
    return { isValid: true };
  }

  const normalizedGeneratedContent = normalizeSemanticText(generatedContent);
  const matchedLabels = uniqueExpectedLabels.filter((label) => normalizedGeneratedContent.includes(label));
  const coverage = matchedLabels.length / uniqueExpectedLabels.length;
  const coverageThreshold = resolveLabelCoverageThreshold(uniqueExpectedLabels.length);

  if (coverage < coverageThreshold) {
    const missingLabels = uniqueExpectedLabels.filter((label) => !matchedLabels.includes(label)).slice(0, 6);
    return {
      isValid: false,
      reason: `label fidelity too low (${Math.round(coverage * 100)}% < ${Math.round(
        coverageThreshold * 100
      )}%), missing: ${missingLabels.join(", ")}`
    };
  }

  const baselinePlaceholders = new Set(collectPlaceholderMatches(baselineContent));
  const candidatePlaceholders = collectPlaceholderMatches(generatedContent);
  const introducedPlaceholders = candidatePlaceholders.filter((value) => !baselinePlaceholders.has(value));
  if (introducedPlaceholders.length > 0) {
    return {
      isValid: false,
      reason: `generic placeholders introduced (${introducedPlaceholders.slice(0, 3).join(", ")}) although semantic labels are available`
    };
  }

  return { isValid: true };
};

const validateSelectLiteralFidelity = ({
  generatedContent,
  baselineContent,
  expectation
}: {
  generatedContent: string;
  baselineContent: string;
  expectation: ScreenInteractivityExpectation;
}): { isValid: boolean; reason?: string } => {
  if (expectation.selectCount <= 0) {
    return { isValid: true };
  }

  const baselineSelectLiterals = collectSelectOptionLiterals(baselineContent);
  if (baselineSelectLiterals.length === 0) {
    return { isValid: true };
  }

  const normalizedGeneratedContent = normalizeSemanticText(generatedContent);
  const normalizedBaselineLiterals = baselineSelectLiterals.map((value) => normalizeSemanticText(value)).filter((value) => value.length > 0);
  if (normalizedBaselineLiterals.length === 0) {
    return { isValid: true };
  }

  const matchedCount = normalizedBaselineLiterals.filter((value) => normalizedGeneratedContent.includes(value)).length;
  const minMatchCount =
    normalizedBaselineLiterals.length <= 3
      ? normalizedBaselineLiterals.length
      : Math.max(2, Math.ceil(normalizedBaselineLiterals.length * 0.66));
  if (matchedCount < minMatchCount) {
    const missingPreview = baselineSelectLiterals
      .filter((value) => {
        const normalized = normalizeSemanticText(value);
        return normalized.length > 0 && !normalizedGeneratedContent.includes(normalized);
      })
      .slice(0, 4);
    return {
      isValid: false,
      reason: `missing select options from deterministic baseline: ${missingPreview.join(", ")}`
    };
  }

  return { isValid: true };
};

const inferScreenInteractivityExpectation = (screen: ScreenIR): ScreenInteractivityExpectation => {
  const nodes = flattenElements(screen.children);
  const names = nodes.map((node) => node.name.toLowerCase());

  const selectCount =
    names.filter((name) => name.includes("muiselectselect") || name.includes("select")).length +
    nodes.filter((node) => node.type === "select").length;
  const inputCount =
    names.filter((name) => INPUT_NAME_HINTS.some((pattern) => name.includes(pattern))).length +
    nodes.filter((node) => node.type === "input").length;
  const accordionCount = names.filter((name) => name.includes("accordionsummarycontent") || name.includes("collapsewrapper"))
    .length;

  return {
    inputCount,
    selectCount,
    accordionCount
  };
};

const validateLlmScreenByExpectation = (
  file: GeneratedFile,
  expectedPath: string,
  expectation: ScreenInteractivityExpectation,
  screen: ScreenIR,
  baselineContent: string,
  typeScriptRuntime: TypeScriptRuntime,
  requiredLabelSet?: string[]
): { isValid: boolean; reason?: string } => {
  const normalizedExpectedPath = path.posix.normalize(expectedPath.replace(/\\/g, "/"));

  if (normalizedExpectedPath.startsWith("/") || normalizedExpectedPath.includes("..")) {
    return { isValid: false, reason: `unsafe screen path '${expectedPath}'` };
  }

  const content = file.content;
  if (!content.includes("export default") || !content.includes("@mui")) {
    return { isValid: false, reason: "missing export/@mui imports" };
  }
  if (!/@mui\/material/.test(content)) {
    return { isValid: false, reason: "missing @mui/material import usage" };
  }

  const screenDiagnostics = typeScriptRuntime.transpileModule(content, {
    compilerOptions: {
      module: typeScriptRuntime.ModuleKind.ESNext,
      target: typeScriptRuntime.ScriptTarget.ES2022,
      jsx: typeScriptRuntime.JsxEmit.ReactJSX
    },
    fileName: file.path,
    reportDiagnostics: true
  }).diagnostics;
  if (screenDiagnostics && screenDiagnostics.length > 0) {
    const firstDiagnostic = screenDiagnostics[0];
    return {
      isValid: false,
      reason: firstDiagnostic
        ? typeScriptRuntime.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n")
        : "TypeScript diagnostics reported an unknown issue"
    };
  }

  const hasInputLikeControl =
    /\b(TextField|InputBase|OutlinedInput|FilledInput|Input|TextareaAutosize|Checkbox|Switch|RadioGroup|Radio|Slider|Autocomplete|Select|NativeSelect)\b/.test(
      content
    );
  const hasSelectControl =
    /\b(Select|NativeSelect)\b/.test(content) || /<TextField[\s\S]{0,220}?\bselect\b/.test(content);
  const hasAccordion = /\bAccordionSummary\b/.test(content) || /\bAccordionDetails\b/.test(content);
  const hasHandlerBinding = /\b(onChange|onInput|onClick|onBlur)\s*=\s*\{/.test(content);
  const hasDefaultBinding = /\bdefault(Value|Checked|Open)\s*=/.test(content);
  const hasControlledBinding = /\b(value|checked|open)\s*=\s*\{[^}]+\}/.test(content);
  const hasReadOnlyPattern = hasControlledBinding && !hasHandlerBinding && !hasDefaultBinding;

  if (expectation.inputCount > 0 && !hasInputLikeControl) {
    return { isValid: false, reason: "missing MUI form controls for detected input nodes" };
  }
  if (expectation.inputCount > 0 && hasReadOnlyPattern) {
    return { isValid: false, reason: "read-only value/checked/open bindings detected for form controls" };
  }
  if (expectation.selectCount > 0 && !hasSelectControl) {
    return { isValid: false, reason: "missing select-like MUI control for detected select nodes" };
  }
  if (expectation.accordionCount > 0 && !hasAccordion) {
    return { isValid: false, reason: "missing Accordion primitives for detected accordion nodes" };
  }

  const selectLiteralValidation = validateSelectLiteralFidelity({
    generatedContent: content,
    baselineContent,
    expectation
  });
  if (!selectLiteralValidation.isValid) {
    return selectLiteralValidation;
  }

  const fidelityValidation = validateSemanticFidelity({
    screen,
    generatedContent: content,
    baselineContent,
    ...(requiredLabelSet ? { requiredLabelSet } : {})
  });
  if (!fidelityValidation.isValid) {
    return fidelityValidation;
  }

  return { isValid: true };
};

const isWeakLlmForCodegen = (modelName: string): boolean => {
  const normalized = modelName.toLowerCase();
  return normalized.includes("qwen2.5-0.5b-instruct-4bit");
};

const getObjectPropertyName = ({
  propertyName,
  typeScriptRuntime
}: {
  propertyName: ts.PropertyName;
  typeScriptRuntime: TypeScriptRuntime;
}): string | undefined => {
  if (
    typeScriptRuntime.isIdentifier(propertyName) ||
    typeScriptRuntime.isStringLiteral(propertyName) ||
    typeScriptRuntime.isNumericLiteral(propertyName)
  ) {
    return propertyName.text;
  }
  return undefined;
};

const hasTopLevelBorderRadiusInCreateTheme = ({
  source,
  typeScriptRuntime
}: {
  source: ts.SourceFile;
  typeScriptRuntime: TypeScriptRuntime;
}): boolean => {
  let detected = false;

  const visit = (node: ts.Node): void => {
    if (detected) {
      return;
    }

    if (
      typeScriptRuntime.isCallExpression(node) &&
      typeScriptRuntime.isIdentifier(node.expression) &&
      node.expression.text === "createTheme"
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument && typeScriptRuntime.isObjectLiteralExpression(firstArgument)) {
        for (const property of firstArgument.properties) {
          if (!typeScriptRuntime.isPropertyAssignment(property) && !typeScriptRuntime.isShorthandPropertyAssignment(property)) {
            continue;
          }
          const propertyName = getObjectPropertyName({
            propertyName: property.name,
            typeScriptRuntime
          });
          if (propertyName === "borderRadius") {
            detected = true;
            return;
          }
        }
      }
    }

    typeScriptRuntime.forEachChild(node, visit);
  };

  visit(source);
  return detected;
};

const normalizeThemeCandidateContent = (content: string): string => {
  if (/export\s+const\s+appTheme\b/.test(content)) {
    return content;
  }

  let normalized = content;

  normalized = normalized.replace(
    /export\s+default\s+createTheme\s*\(/,
    "export const appTheme = createTheme("
  );
  if (/export\s+const\s+appTheme\b/.test(normalized)) {
    return normalized;
  }

  const themedVarMatch = normalized.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*createTheme\s*\(/);
  if (themedVarMatch?.[1]) {
    const varName = themedVarMatch[1];
    const defaultVarExportPattern = new RegExp(`export\\s+default\\s+${varName}\\s*;?`);
    if (defaultVarExportPattern.test(normalized)) {
      normalized = normalized.replace(defaultVarExportPattern, `export const appTheme = ${varName};`);
    }
  }

  return normalized;
};

const validateLlmThemeCandidate = ({
  file,
  expectedPath,
  typeScriptRuntime
}: {
  file: GeneratedFile;
  expectedPath: string;
  typeScriptRuntime: TypeScriptRuntime;
}): { isValid: boolean; reason?: string } => {
  const normalizedExpectedPath = path.posix.normalize(expectedPath.replace(/\\/g, "/"));

  if (normalizedExpectedPath.startsWith("/") || normalizedExpectedPath.includes("..")) {
    return { isValid: false, reason: `unsafe theme path '${expectedPath}'` };
  }

  const content = file.content;
  const hasNamedThemeExport = /export\s+const\s+appTheme\b/.test(content);
  if (!hasNamedThemeExport) {
    return { isValid: false, reason: "missing named export 'appTheme'" };
  }
  if (!/\bcreateTheme\s*\(/.test(content)) {
    return { isValid: false, reason: "missing createTheme() call" };
  }
  if (!/from\s+["']@mui\/material\/styles["']/.test(content)) {
    return { isValid: false, reason: "missing createTheme import from @mui/material/styles" };
  }
  if (/from\s+["']\.\.?\//.test(content)) {
    return { isValid: false, reason: "relative imports are not allowed in theme.ts" };
  }

  const syntaxDiagnostics = typeScriptRuntime.transpileModule(content, {
    compilerOptions: {
      module: typeScriptRuntime.ModuleKind.ESNext,
      target: typeScriptRuntime.ScriptTarget.ES2022
    },
    fileName: file.path,
    reportDiagnostics: true
  }).diagnostics;
  if (syntaxDiagnostics && syntaxDiagnostics.length > 0) {
    const firstDiagnostic = syntaxDiagnostics[0];
    return {
      isValid: false,
      reason: firstDiagnostic
        ? typeScriptRuntime.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n")
        : "TypeScript diagnostics reported an unknown issue"
    };
  }
  const source = typeScriptRuntime.createSourceFile(
    file.path,
    content,
    typeScriptRuntime.ScriptTarget.ESNext,
    true,
    typeScriptRuntime.ScriptKind.TS
  );

  if (hasTopLevelBorderRadiusInCreateTheme({ source, typeScriptRuntime })) {
    return { isValid: false, reason: "top-level borderRadius is invalid; use shape.borderRadius" };
  }

  return { isValid: true };
};

export const generateArtifacts = async ({
  projectDir,
  ir,
  componentMappings,
  llmClient,
  llmModelName,
  llmCodegenMode,
  onLog
}: GenerateArtifactsInput): Promise<GenerateArtifactsResult> => {
  const requestedMode = String(llmCodegenMode);
  if (llmCodegenMode !== "deterministic") {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: "Only deterministic code generation is supported in workspace-dev."
    });
  }

  const generatedPaths = new Set<string>();
  const generationMetrics: GenerationMetrics = {
    fetchedNodes: ir.metrics?.fetchedNodes ?? 0,
    skippedHidden: ir.metrics?.skippedHidden ?? 0,
    skippedPlaceholders: ir.metrics?.skippedPlaceholders ?? 0,
    screenElementCounts: [...(ir.metrics?.screenElementCounts ?? [])],
    truncatedScreens: [...(ir.metrics?.truncatedScreens ?? [])],
    degradedGeometryNodes: [...(ir.metrics?.degradedGeometryNodes ?? [])]
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

  const tokensPath = path.join(projectDir, "src", "theme", "tokens.json");
  await writeFile(tokensPath, JSON.stringify(ir.tokens, null, 2), "utf-8");
  generatedPaths.add("src/theme/tokens.json");

  const deterministicTheme = fallbackThemeFile(ir);
  await writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);

  const identitiesByScreenId = buildScreenArtifactIdentities(ir.screens);
  const usedMappingNodeIds = new Set<string>();
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
      ...(identity?.componentName ? { componentNameOverride: identity.componentName } : {}),
      ...(identity?.filePath ? { filePathOverride: identity.filePath } : {}),
      ...(truncationMetric ? { truncationMetric } : {})
    });
    for (const nodeId of deterministicScreen.usedMappingNodeIds.values()) {
      usedMappingNodeIds.add(nodeId);
    }
    for (const warning of deterministicScreen.mappingWarnings) {
      mappingWarnings.push({
        code: warning.code,
        message: warning.message
      });
    }

    const file = deterministicScreen.file;
    return {
      screen,
      file,
      requiredLiteralTexts: [
        ...collectLiteralLabelCandidates(screen),
        ...collectSelectOptionLiterals(file.content)
      ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index)
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
      identitiesByScreenId
    }),
    "utf-8"
  );
  generatedPaths.add("src/App.tsx");

  const generationMetricsPath = path.join(projectDir, "generation-metrics.json");
  await writeFile(generationMetricsPath, `${JSON.stringify(generationMetrics, null, 2)}\n`, "utf-8");
  generatedPaths.add("generation-metrics.json");

  if (generationMetrics.degradedGeometryNodes.length > 0) {
    onLog(`Geometry degraded for ${generationMetrics.degradedGeometryNodes.length} node(s) during staged fetch.`);
  }

  onLog("Generated deterministic baseline artifacts");

  let themeApplied = false;
  let screenApplied = 0;
  const screenRejected: RejectedScreenEnhancement[] = [];
  const llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }> = [];
  const screenTotal = deterministicScreens.length;

  const pushLlmIncompleteWarning = (message: string): void => {
    if (llmWarnings.some((warning) => warning.message === message)) {
      return;
    }
    llmWarnings.push({
      code: "W_LLM_RESPONSES_INCOMPLETE",
      message
    });
  };

  const strictLlmMode = requestedMode === "llm_strict";
  const deterministicMode = requestedMode === "deterministic";
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
  if (deterministicMode) {
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
  }

  if (!llmClient) {
    throw new Error("LLM client is required for hybrid and llm_strict modes");
  }

  const skipLlmEnhancement = requestedMode === "hybrid" && isWeakLlmForCodegen(llmModelName);
  if (skipLlmEnhancement) {
    onLog(
      `LLM enhancement skipped for model '${llmModelName}' in hybrid mode; deterministic output retained`
    );
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
  }

  let typeScriptRuntime: TypeScriptRuntime;
  try {
    typeScriptRuntime = await import("typescript");
  } catch (error) {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: `TypeScript runtime unavailable for non-deterministic mode: ${error instanceof Error ? error.message : "unknown error"}`
    });
  }

  try {
    onLog("Running optional LLM theme enhancement");
    const llmTheme = await llmClient.generateTheme(ir);
    const normalizedThemeContent = normalizeThemeCandidateContent(llmTheme.content);
    const themeValidation = validateLlmThemeCandidate({
      file: {
        path: llmTheme.path,
        content: normalizedThemeContent
      },
      expectedPath: deterministicTheme.path,
      typeScriptRuntime
    });
    if (!themeValidation.isValid) {
      const message = strictLlmMode
        ? `LLM theme enhancement rejected by strict contract: ${
            themeValidation.reason ?? "contract validation failed"
          }; deterministic output retained`
        : `LLM theme enhancement skipped: ${
            themeValidation.reason ?? "contract validation failed"
          }; deterministic output retained`;
      onLog(message);
    } else {
      await writeGeneratedFile(projectDir, {
        path: deterministicTheme.path,
        content: normalizedThemeContent
      });
      themeApplied = true;
      onLog("LLM theme enhancement applied");
    }
  } catch (error) {
    if (isEgressPolicyDenyError(error)) {
      throw new WorkflowError({
        code: "E_EGRESS_POLICY_DENY",
        stage: "codegen.generate",
        retryable: false,
        message: error instanceof Error ? error.message : "Egress policy denied outbound request"
      });
    }
    const llmIncomplete = isLlmClientError(error) && error.code === "E_LLM_RESPONSES_INCOMPLETE";
    if (llmIncomplete) {
      const incompleteMessage = `LLM responses incomplete during theme enhancement; deterministic theme retained`;
      if (strictLlmMode) {
        throw new WorkflowError({
          code: "E_LLM_RESPONSES_INCOMPLETE",
          stage: "codegen.generate",
          retryable: false,
          message: `${incompleteMessage} (${error.message})`
        });
      }
      pushLlmIncompleteWarning(incompleteMessage);
    }
    const message = strictLlmMode
      ? `LLM theme enhancement rejected by strict execution error: ${
          error instanceof Error ? error.message : "unknown error"
        }; deterministic output retained`
      : `LLM theme enhancement skipped: ${error instanceof Error ? error.message : "unknown error"}; deterministic output retained`;
    onLog(message);
  }

  for (const { screen, file: deterministicScreen, requiredLiteralTexts } of deterministicScreens) {
    const interactivityExpectation = inferScreenInteractivityExpectation(screen);
    const totalAttempts = 3;
    let lastFailureReason = "contract validation failed";
    let screenAppliedInAttempt = false;

    onLog(`Running optional LLM screen enhancement: ${screen.name}`);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        const llmFile =
          attempt < totalAttempts
            ? await llmClient.generateScreen(screen, ir.tokens, deterministicScreen.path, {
                ...interactivityExpectation,
                ...(attempt === 1 ? {} : { repairReason: lastFailureReason }),
                requiredLabelSet: requiredLiteralTexts
              })
            : await llmClient.generateScreenFromBaseline({
                screen,
                tokens: ir.tokens,
                expectedPath: deterministicScreen.path,
                baselineSource: deterministicScreen.content,
                requiredLiteralTexts,
                forbiddenPlaceholderPolicy:
                  "Never introduce generic placeholders that do not already exist in baseline content.",
                hints: {
                  ...interactivityExpectation,
                  repairReason: lastFailureReason,
                  requiredLabelSet: requiredLiteralTexts
                }
              });

        const validation = validateLlmScreenByExpectation(
          llmFile,
          deterministicScreen.path,
          interactivityExpectation,
          screen,
          deterministicScreen.content,
          typeScriptRuntime,
          requiredLiteralTexts
        );

        if (validation.isValid) {
          await writeGeneratedFile(projectDir, { path: deterministicScreen.path, content: llmFile.content });
          screenApplied += 1;
          screenAppliedInAttempt = true;
          onLog(`LLM screen enhancement applied (${screen.name}) [attempt ${attempt}/${totalAttempts}]`);
          break;
        }

        lastFailureReason = validation.reason ?? "contract validation failed";
        if (attempt < totalAttempts) {
          onLog(
            `LLM screen enhancement retry (${screen.name}) [attempt ${attempt + 1}/${totalAttempts}]: ${lastFailureReason}`
          );
        }
      } catch (error) {
        if (isEgressPolicyDenyError(error)) {
          throw new WorkflowError({
            code: "E_EGRESS_POLICY_DENY",
            stage: "codegen.generate",
            retryable: false,
            message: error instanceof Error ? error.message : "Egress policy denied outbound request"
          });
        }
        lastFailureReason = error instanceof Error ? error.message : "unknown error";
        const llmIncomplete = isLlmClientError(error) && error.code === "E_LLM_RESPONSES_INCOMPLETE";
        if (llmIncomplete) {
          const incompleteMessage = `LLM responses incomplete during screen enhancement (${screen.name}); deterministic screen retained`;
          if (strictLlmMode) {
            throw new WorkflowError({
              code: "E_LLM_RESPONSES_INCOMPLETE",
              stage: "codegen.generate",
              retryable: false,
              message: `${incompleteMessage} (${lastFailureReason})`
            });
          }
          pushLlmIncompleteWarning(incompleteMessage);
        }
        if (attempt < totalAttempts) {
          onLog(
            `LLM screen enhancement retry (${screen.name}) [attempt ${attempt + 1}/${totalAttempts}]: ${lastFailureReason}`
          );
        }
      }
    }

    if (!screenAppliedInAttempt) {
      screenRejected.push({
        screenName: screen.name,
        reason: lastFailureReason
      });
      if (lastFailureReason.includes("E_LLM_RESPONSES_INCOMPLETE")) {
        pushLlmIncompleteWarning(
          `LLM responses incomplete during screen enhancement (${screen.name}); deterministic screen retained`
        );
      }
      const message = strictLlmMode
        ? `LLM screen enhancement rejected by strict contract (${screen.name}) [attempt ${totalAttempts}/${totalAttempts}]: ${lastFailureReason}; deterministic output retained`
        : `LLM screen enhancement skipped (${screen.name}) [attempt ${totalAttempts}/${totalAttempts}]: ${lastFailureReason}; deterministic output retained`;
      onLog(message);
    }
  }
  onLog(`LLM enhancement summary: themeApplied=${String(themeApplied)}, screensApplied=${screenApplied}/${screenTotal}`);
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
