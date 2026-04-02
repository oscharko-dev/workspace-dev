// ---------------------------------------------------------------------------
// generator-render.ts — Core element → JSX rendering utilities
// Extracted from generator-core.ts (issue #297)
// ---------------------------------------------------------------------------
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isTextElement
} from "./types.js";
import type {
  ComponentMappingRule,
  DesignTokens,
  DesignTokenTypographyVariantName,
  GeneratedFile,
  SimplificationMetrics,
  ScreenElementIR,
  ScreenIR,
  ScreenResponsiveLayoutOverridesByBreakpoint
} from "./types.js";
import { BUILTIN_ICON_FALLBACK_CATALOG, ICON_FALLBACK_MAP_VERSION } from "./icon-fallback-catalog.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";
import {
  HEADING_FONT_SIZE_MIN,
  HEADING_FONT_WEIGHT_MIN,
  LARGE_HEADING_FONT_SIZE_MIN,
  LARGE_HEADING_FONT_WEIGHT_MIN,
  CSS_GRID_SPAN_WIDTH_RATIO,
  CSS_GRID_SPAN_HEIGHT_RATIO,
  CSS_GRID_ASYMMETRIC_CV_THRESHOLD,
  CSS_GRID_MIN_CHILDREN
} from "./constants.js";
import {
  normalizeOpacityForSx,
  firstText,
  firstTextColor,
  firstVectorColor,
  collectTextNodes,
  collectVectorPaths,
  fallbackScreenFile,
  makeAppFile,
  DEFAULT_SPACING_BASE,
  literal,
  escapeXmlText,
  toRenderableAssetSource,
  normalizeFontFamily,
  toLetterSpacingEm
} from "./generator-templates.js";
import type { WorkspaceFormHandlingMode } from "../contracts/index.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import {
  A11Y_NAVIGATION_HINTS,
  A11Y_IMAGE_DECORATIVE_HINTS,
  HEADING_NAME_HINTS
} from "./generator-a11y.js";
import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";
import type { WorkspaceRouterMode } from "../contracts/index.js";
import { normalizeInputSemanticText } from "./generator-forms.js";
import type { InteractiveFieldModel } from "./generator-forms.js";
import type { AccessibilityWarning } from "./generator-a11y.js";
import { toElementSx } from "./generator-templates.js";
import type { ResolvedStorybookTypographyStyle } from "../storybook/theme-resolver.js";



export interface VirtualParent {
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  name?: string | undefined;
  fillColor?: string | undefined;
  fillGradient?: string | undefined;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE" | undefined;
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export type ButtonVariant = "contained" | "outlined" | "text";
export type ButtonSize = "small" | "medium" | "large";
export type { ValidationFieldType } from "./generator-forms.js";
export type ResolvedFormHandlingMode = WorkspaceFormHandlingMode;
export type HeadingComponent = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type LandmarkRole = "navigation";

// Interactive model types — defined here to avoid circular dependency
// since RenderContext references them.
export interface InteractiveAccordionModel {
  key: string;
  defaultExpanded: boolean;
}

export interface InteractiveTabsModel {
  elementId: string;
  stateId: number;
}

export interface InteractiveDialogModel {
  elementId: string;
  stateId: number;
}

// Pattern types — defined here since RenderContext references them.
export interface PatternExtractionInvocation {
  componentName: string;
  instanceId: string;
  usesPatternContext: boolean;
  propValues: Record<string, string | undefined>;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const hasVisualStyle = (element: ScreenElementIR): boolean => {
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

const SELF_RENDERING_CONTROL_TYPES = new Set<ScreenElementIR["type"]>([
  "slider",
  "switch",
  "checkbox",
  "radio",
  "rating",
  "progress"
]);

const hasPromotionBlockingVisualStyle = (element: ScreenElementIR): boolean => {
  return Boolean(
    element.fillColor ||
      element.fillGradient ||
      normalizeOpacityForSx(element.opacity) !== undefined ||
      element.insetShadow ||
      (typeof element.elevation === "number" && element.elevation > 0) ||
      element.strokeColor ||
      (element.cornerRadius ?? 0) > 0
  );
};

const GROUP_MULTI_CHILD_PROMOTION_MIN_DEPTH = 3;

export const createEmptySimplificationStats = (): SimplificationMetrics => {
  return {
    removedEmptyNodes: 0,
    promotedSingleChild: 0,
    promotedGroupMultiChild: 0,
    spacingMerges: 0,
    guardedSkips: 0
  };
};


const normalizeSpacingValues = (
  spacing: ScreenElementIR["padding"] | undefined
): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} => {
  return {
    top: spacing?.top ?? 0,
    right: spacing?.right ?? 0,
    bottom: spacing?.bottom ?? 0,
    left: spacing?.left ?? 0
  };
};

const mergeSpacingIntoPromotedChild = ({
  parent,
  child,
  stats
}: {
  parent: ScreenElementIR;
  child: ScreenElementIR;
  stats: SimplificationMetrics;
}): ScreenElementIR => {
  const parentMargin = normalizeSpacingValues(parent.margin);
  const parentPadding = normalizeSpacingValues(parent.padding);
  const additiveSpacing = {
    top: parentMargin.top + parentPadding.top,
    right: parentMargin.right + parentPadding.right,
    bottom: parentMargin.bottom + parentPadding.bottom,
    left: parentMargin.left + parentPadding.left
  };
  const hasSpacingContribution =
    additiveSpacing.top !== 0 ||
    additiveSpacing.right !== 0 ||
    additiveSpacing.bottom !== 0 ||
    additiveSpacing.left !== 0;
  if (!hasSpacingContribution) {
    return child;
  }

  const childMargin = normalizeSpacingValues(child.margin);
  const mergedChild: ScreenElementIR = {
    ...child,
    margin: {
      top: childMargin.top + additiveSpacing.top,
      right: childMargin.right + additiveSpacing.right,
      bottom: childMargin.bottom + additiveSpacing.bottom,
      left: childMargin.left + additiveSpacing.left
    }
  };
  stats.spacingMerges += 1;
  return mergedChild;
};

export const isIconLikeNode = (element: ScreenElementIR): boolean => {
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

export const isVectorGraphicNode = (element: ScreenElementIR): boolean => {
  if (isTextElement(element)) {
    return false;
  }
  const vectorPaths = collectVectorPaths(element);
  if (vectorPaths.length === 0) {
    return false;
  }
  const hasMeaningfulText = collectTextNodes(element).some((node) => /[a-z0-9]/i.test(node.text.trim()));
  if (hasMeaningfulText) {
    return false;
  }
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const area = width * height;
  return (
    (width > 0 && height > 0 && width <= 160 && height <= 160) ||
    (area > 0 && area <= 16_000)
  );
};

export const isSemanticIconWrapper = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return loweredName.includes("buttonendicon") || loweredName.includes("expandiconwrapper");
};

const hasStructuralSemanticContainerHints = (element: ScreenElementIR): boolean => {
  return element.type === "container" && Boolean(element.semanticType || element.semanticName);
};

const resolvePromotionMode = ({
  element,
  depth
}: {
  element: ScreenElementIR;
  depth: number;
}): {
  mode: "none" | "single-child" | "group-multi-child";
  guarded: boolean;
} => {
  if (element.type !== "container") {
    return { mode: "none", guarded: false };
  }

  const children = element.children ?? [];
  if (children.length === 0) {
    return { mode: "none", guarded: false };
  }
  const ownText = element.text?.trim();

  const blockedByGuardrails = Boolean(
    element.prototypeNavigation ||
      hasStructuralSemanticContainerHints(element) ||
      isIconLikeNode(element) ||
      isSemanticIconWrapper(element) ||
      hasPromotionBlockingVisualStyle(element) ||
      ownText ||
      children.some((child) => {
        return (
          Boolean(child.prototypeNavigation) ||
          isIconLikeNode(child) ||
          isSemanticIconWrapper(child)
        );
      })
  );
  if (blockedByGuardrails) {
    return { mode: "none", guarded: true };
  }

  if (children.length === 1) {
    return { mode: "single-child", guarded: false };
  }

  if (element.nodeType === "GROUP" && depth >= GROUP_MULTI_CHILD_PROMOTION_MIN_DEPTH) {
    return { mode: "group-multi-child", guarded: false };
  }

  return { mode: "none", guarded: false };
};

const simplifyNode = ({
  element,
  depth,
  stats
}: {
  element: ScreenElementIR;
  depth: number;
  stats: SimplificationMetrics;
}): ScreenElementIR | null => {
  const simplifiedChildren = simplifyElements({
    elements: element.children ?? [],
    depth: depth + 1,
    stats
  });
  const isSvgIconRoot = isIconLikeNode(element);
  const hasVectorPayload = element.nodeType === "VECTOR" && (element.vectorPaths?.length ?? 0) > 0;

  const simplified: ScreenElementIR = {
    ...element,
    children: simplifiedChildren
  };

  if (isTextElement(simplified)) {
    return simplified.text.trim() ? simplified : null;
  }

  if (simplified.type === "image") {
    return simplified;
  }

  if (SELF_RENDERING_CONTROL_TYPES.has(simplified.type)) {
    return simplified;
  }

  if (hasVectorPayload) {
    return simplified;
  }

  if (isSvgIconRoot || isSemanticIconWrapper(element)) {
    return simplified;
  }

  const hasChildren = simplifiedChildren.length > 0;
  const simplifiedOwnText = simplified.text?.trim();
  if (!hasChildren && !hasVisualStyle(simplified) && !simplifiedOwnText) {
    if (simplified.prototypeNavigation) {
      return simplified;
    }
    if (hasStructuralSemanticContainerHints(simplified)) {
      return simplified;
    }
    stats.removedEmptyNodes += 1;
    return null;
  }

  return simplified;
};

export const simplifyElements = ({
  elements,
  depth,
  stats
}: {
  elements: ScreenElementIR[];
  depth: number;
  stats: SimplificationMetrics;
}): ScreenElementIR[] => {
  const result: ScreenElementIR[] = [];

  for (const element of elements) {
    const simplified = simplifyNode({
      element,
      depth,
      stats
    });
    if (!simplified) {
      continue;
    }

    const promotionMode = resolvePromotionMode({
      element: simplified,
      depth
    });
    if (promotionMode.guarded) {
      stats.guardedSkips += 1;
    }

    if (promotionMode.mode === "single-child") {
      const [promotedChild] = simplified.children ?? [];
      if (!promotedChild) {
        result.push(simplified);
        continue;
      }
      stats.promotedSingleChild += 1;
      result.push(
        mergeSpacingIntoPromotedChild({
          parent: simplified,
          child: promotedChild,
          stats
        })
      );
      continue;
    }

    if (promotionMode.mode === "group-multi-child") {
      stats.promotedGroupMultiChild += 1;
      result.push(...(simplified.children ?? []));
      continue;
    }

    result.push(simplified);
  }

  return result;
};

export const RTL_LANGUAGE_CODES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

/** Icon component names that represent directional concepts and should be mirrored in RTL layouts. */
export const DIRECTIONAL_ICON_NAMES: ReadonlySet<string> = new Set([
  "ArrowBackIcon",
  "ArrowForwardIcon",
  "ArrowBackIosIcon",
  "ArrowForwardIosIcon",
  "ArrowLeftIcon",
  "ArrowRightIcon",
  "ChevronLeftIcon",
  "ChevronRightIcon",
  "NavigateBeforeIcon",
  "NavigateNextIcon",
  "KeyboardArrowLeftIcon",
  "KeyboardArrowRightIcon",
  "LastPageIcon",
  "FirstPageIcon",
  "SendIcon",
  "ReplyIcon",
  "ForwardIcon",
  "RedoIcon",
  "UndoIcon"
]);

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

export const isRtlLocale = (locale: string | undefined): boolean => {
  const languageCode = toLocaleLanguageCode(locale);
  if (!languageCode) {
    return false;
  }
  return RTL_LANGUAGE_CODES.has(languageCode);
};

const toSortSemanticBucket = (element: ScreenElementIR): number => {
  const normalizedName = normalizeInputSemanticText(element.name || "");
  const ownText = isTextElement(element) ? element.text.trim() : element.text?.trim() || "";
  const normalizedText = normalizeInputSemanticText(ownText);
  const combinedSemanticText = `${normalizedName} ${normalizedText}`.trim();
  const hasHeadingHint = HEADING_NAME_HINTS.some((hint) => combinedSemanticText.includes(hint));
  const fontSize = typeof element.fontSize === "number" && Number.isFinite(element.fontSize) ? element.fontSize : 0;
  const fontWeight = typeof element.fontWeight === "number" && Number.isFinite(element.fontWeight) ? element.fontWeight : 0;
  const isLargeHeadingText = element.type === "text" && (fontSize >= LARGE_HEADING_FONT_SIZE_MIN || (fontSize >= HEADING_FONT_SIZE_MIN && fontWeight >= LARGE_HEADING_FONT_WEIGHT_MIN));
  if (hasHeadingHint || isLargeHeadingText) {
    return 0;
  }

  const hasNavigationHint = A11Y_NAVIGATION_HINTS.some((hint) => normalizedName.includes(hint));
  if (element.type === "navigation" || hasNavigationHint) {
    return 1;
  }

  const hasReadableText = Boolean(firstText(element)?.trim() || ownText);
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

export const sortChildren = (
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

export const approximatelyEqualNumber = ({
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
    (typeof node.fontSize === "number" && node.fontSize >= HEADING_FONT_SIZE_MIN) ||
    (typeof node.fontWeight === "number" && node.fontWeight >= HEADING_FONT_WEIGHT_MIN)
  );
};

export const resolveTypographyVariantByNodeId = ({
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

export const hasMeaningfulTextDescendants = ({
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
    const text = node.text.trim();
    if (!text) {
      return false;
    }
    return /[a-z0-9]/i.test(text);
  });
  context.meaningfulTextDescendantCache.set(element.id, resolved);
  return resolved;
};

export const collectIconNodes = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): ScreenElementIR[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  const local = isIconLikeNode(element) || isVectorGraphicNode(element) ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectIconNodes(child, visited));
  return [...local, ...nested];
};

export const collectSubtreeNames = (element: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): string[] => {
  if (visited.has(element)) {
    return [];
  }
  visited.add(element);
  return [element.name, ...(element.children ?? []).flatMap((child) => collectSubtreeNames(child, visited))];
};

export const toDeterministicImagePlaceholderSrc = ({
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

export const resolveImageSource = ({
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
    return toRenderableAssetSource(mappedSource);
  }
  if (typeof element.asset?.source === "string" && element.asset.source.trim().length > 0) {
    return toRenderableAssetSource(element.asset.source);
  }
  return toDeterministicImagePlaceholderSrc({
    element,
    label: fallbackLabel
  });
};

export const pickBestIconNode = (element: ScreenElementIR): ScreenElementIR | undefined => {
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

export const hasSubtreeName = (element: ScreenElementIR, pattern: string): boolean => {
  if (element.name.toLowerCase().includes(pattern.toLowerCase())) {
    return true;
  }
  return (element.children ?? []).some((child) => hasSubtreeName(child, pattern));
};

export const findFirstByName = (element: ScreenElementIR, pattern: string): ScreenElementIR | undefined => {
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

export interface SemanticIconModel {
  paths: string[];
  color?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface IconImportSpec {
  localName: string;
  modulePath: string;
}

export interface IconFallbackMapEntry {
  iconName: string;
  aliases?: string[] | undefined;
}

export interface IconFallbackMap {
  version: number;
  entries: IconFallbackMapEntry[];
  synonyms?: Record<string, string> | undefined;
}

export interface CompiledIconFallbackEntry {
  iconName: string;
  aliases: string[];
  importSpec: IconImportSpec;
  priority: number;
}

export interface IconFallbackResolver {
  entries: CompiledIconFallbackEntry[];
  byIconName: Map<string, CompiledIconFallbackEntry>;
  exactAliasMap: Map<string, CompiledIconFallbackEntry>;
  tokenIndex: Map<string, CompiledIconFallbackEntry[]>;
  synonymMap: Map<string, CompiledIconFallbackEntry>;
}

export interface MappedImportSpec {
  localName: string;
  modulePath: string;
  importMode: "default" | "named";
  importedName?: string;
}

export type PrimitiveJsxPropValue = boolean | number | string;

export interface SpecializedComponentMapping {
  componentKey: string;
  modulePath: string;
  localName: string;
  importedName?: string;
  propMappings: Record<string, string>;
  omittedProps: ReadonlySet<string>;
  defaultProps: Record<string, PrimitiveJsxPropValue>;
}

export interface DatePickerProviderConfig {
  modulePath: string;
  importedName: string;
  localName: string;
  props: Record<string, PrimitiveJsxPropValue>;
  adapter?: {
    modulePath: string;
    importedName: string;
    localName: string;
    propName: string;
  };
}

export interface ExtractedComponentImportSpec {
  componentName: string;
  importPath: string;
}

export interface RenderedButtonModel {
  key: string;
  label: string;
  preferredSubmit: boolean;
  eligibleForSubmit: boolean;
  formGroupId?: string | undefined;
}

export interface RenderContext {
  screenId: string;
  screenName: string;
  screenElements?: readonly ScreenElementIR[] | undefined;
  currentFilePath: string;
  generationLocale: string;
  formHandlingMode: ResolvedFormHandlingMode;
  hasScreenFormFields?: boolean | undefined;
  primarySubmitButtonKey?: string | undefined;
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
  specializedComponentMappings: Partial<Record<string, SpecializedComponentMapping>>;
  storybookTypographyVariants?: Readonly<Record<string, ResolvedStorybookTypographyStyle>> | undefined;
  datePickerProvider?: DatePickerProviderConfig | undefined;
  datePickerProviderResolvedImports?: {
    providerLocalName: string;
    adapterLocalName?: string;
  } | undefined;
  usesDatePickerProvider: boolean;
  spacingBase: number;
  tokens?: DesignTokens | undefined;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  consumedFieldLabelNodeIds?: Set<string> | undefined;
  emittedWarningKeys: Set<string>;
  emittedAccessibilityWarningKeys: Set<string>;
  pageBackgroundColorNormalized: string | undefined;
  themeComponentDefaults?: ThemeComponentDefaults;
  themeSxSampleCollector?: ThemeSxSampleCollector;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
  extractionInvocationByNodeId: Map<string, PatternExtractionInvocation>;
  currentFormGroupId?: string | undefined;
  usesDatePicker?: boolean | undefined;
  requiresChangeEventTypeImport: boolean;
}

const isValidJsIdentifier = (value: string): boolean => {
  return /^[A-Za-z_$][\w$]*$/.test(value);
};

export const registerMuiImports = (context: RenderContext, ...imports: string[]): void => {
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

const resolveElementTextContent = (element: ScreenElementIR): string | undefined => {
  const ownText = typeof element.text === "string" ? element.text.trim() : "";
  if (ownText.length > 0) {
    return ownText;
  }
  return firstText(element);
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
    return resolveElementTextContent(element) ?? "";
  }
  return value;
};

const stripModuleExtension = (value: string): string => {
  return value.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
};

const toNormalizedImportPath = ({
  source,
  currentFilePath
}: {
  source: string;
  currentFilePath: string;
}): string | undefined => {
  const normalizedSource = source.trim().replace(/\\/g, "/");
  if (!normalizedSource) {
    return undefined;
  }
  if (/^https?:\/\//i.test(normalizedSource)) {
    return undefined;
  }
  if (!normalizedSource.startsWith(".") && !normalizedSource.startsWith("/") && !normalizedSource.startsWith("src/")) {
    return stripModuleExtension(normalizedSource);
  }
  const currentDirectory = path.posix.dirname(currentFilePath.replace(/\\/g, "/"));
  if (normalizedSource.startsWith("./") || normalizedSource.startsWith("../")) {
    return stripModuleExtension(normalizedSource);
  }
  let sourcePath = normalizedSource;
  if (sourcePath.startsWith("/")) {
    const srcIndex = sourcePath.lastIndexOf("/src/");
    if (srcIndex < 0) {
      return undefined;
    }
    sourcePath = sourcePath.slice(srcIndex + 1);
  }
  if (!sourcePath.startsWith("src/")) {
    return undefined;
  }
  const relativePath = stripModuleExtension(path.posix.relative(currentDirectory, sourcePath));
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

export const registerMappedImport = ({
  context,
  componentName,
  importPath
}: {
  context: RenderContext;
  componentName: string;
  importPath: string;
}): string => {
  const preferredName = toComponentIdentifier(componentName);
  const existing = context.mappedImports.find((item) => item.localName === preferredName && item.modulePath === importPath);
  if (existing) {
    return existing.localName;
  }

  const existingByModule = context.mappedImports.find((item) => item.modulePath === importPath);
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
    modulePath: importPath,
    importMode: "default"
  });
  const newestImport = context.mappedImports.at(-1);
  return newestImport?.localName ?? "MappedComponent";
};

export const registerNamedMappedImport = ({
  context,
  importedName,
  modulePath,
  localName
}: {
  context: RenderContext;
  importedName: string;
  modulePath: string;
  localName: string;
}): string => {
  const preferredName = toComponentIdentifier(localName);
  const existing = context.mappedImports.find(
    (item) =>
      item.importMode === "named" &&
      item.importedName === importedName &&
      item.modulePath === modulePath
  );
  if (existing) {
    return existing.localName;
  }

  const knownNames = new Set<string>([
    ...context.muiImports,
    ...context.iconImports.map((item) => item.localName),
    ...context.mappedImports.map((item) => item.localName)
  ]);

  let resolvedLocalName = preferredName;
  let suffix = 2;
  while (knownNames.has(resolvedLocalName)) {
    resolvedLocalName = `${preferredName}${suffix}`;
    suffix += 1;
  }

  context.mappedImports.push({
    localName: toIdentifier(resolvedLocalName, "MappedComponent"),
    modulePath,
    importMode: "named",
    importedName
  });
  const newestImport = context.mappedImports.at(-1);
  return newestImport?.localName ?? "MappedComponent";
};

export const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

interface ResolvedMappedElementContract {
  mappingSource: "manual" | "code_connect";
  componentName: string;
  importPath: string;
  propContract?: Record<string, unknown>;
}

const resolveMappedElementContract = ({
  element,
  context
}: {
  element: ScreenElementIR;
  context: RenderContext;
}): ResolvedMappedElementContract | undefined => {
  const manualMapping = context.mappingByNodeId.get(element.id);
  if (manualMapping) {
    if (!manualMapping.enabled) {
      pushMappingWarning({
        context,
        code: "W_COMPONENT_MAPPING_DISABLED",
        nodeId: element.id,
        message: `Component mapping disabled for node '${element.id}', deterministic fallback used`
      });
      return undefined;
    }

    if (!manualMapping.importPath.trim() || !manualMapping.componentName.trim()) {
      pushMappingWarning({
        context,
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        nodeId: element.id,
        message: `Component mapping for node '${element.id}' is missing componentName/importPath, deterministic fallback used`
      });
      return undefined;
    }

    if (manualMapping.propContract !== undefined && !isPlainRecord(manualMapping.propContract)) {
      pushMappingWarning({
        context,
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        nodeId: element.id,
        message: `Component mapping contract for node '${element.id}' is not an object, deterministic fallback used`
      });
      return undefined;
    }
    return {
      mappingSource: "manual",
      componentName: manualMapping.componentName,
      importPath: manualMapping.importPath,
      ...(manualMapping.propContract ? { propContract: manualMapping.propContract } : {})
    };
  }

  if (!element.codeConnect) {
    return undefined;
  }
  const importPath = toNormalizedImportPath({
    source: element.codeConnect.source,
    currentFilePath: context.currentFilePath
  });
  if (!importPath || !element.codeConnect.componentName.trim()) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Code Connect mapping for node '${element.id}' is missing a usable componentName/importPath, deterministic fallback used`
    });
    return undefined;
  }
  if (element.codeConnect.propContract !== undefined && !isPlainRecord(element.codeConnect.propContract)) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Code Connect contract for node '${element.id}' is not an object, deterministic fallback used`
    });
    return undefined;
  }
  return {
    mappingSource: "code_connect",
    componentName: element.codeConnect.componentName,
    importPath,
    ...(element.codeConnect.propContract ? { propContract: element.codeConnect.propContract } : {})
  };
};

export const renderMappedElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | undefined => {
  const mapping = resolveMappedElementContract({
    element,
    context
  });
  if (!mapping) {
    return undefined;
  }
  const componentName = registerMappedImport({
    context,
    componentName: mapping.componentName,
    importPath: mapping.importPath
  });
  if (mapping.mappingSource === "manual") {
    context.usedMappingNodeIds.add(element.id);
  }
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

  const implicitText = resolveElementTextContent(element);
  if (implicitText) {
    return `${indent}<${componentName} ${props}>{${literal(implicitText)}}</${componentName}>`;
  }

  return `${indent}<${componentName} ${props} />`;
};

export const toStateKey = (element: ScreenElementIR): string => {
  const sanitized = element.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  return `${sanitized}_${element.id.replace(/[^a-zA-Z0-9]+/g, "_")}`;
};

const ICON_DEEP_IMPORT_PATTERN = /^@mui\/icons-material\/[A-Z][A-Za-z0-9]+$/;

export const isDeepIconImport = (modulePath: string): boolean => {
  return ICON_DEEP_IMPORT_PATTERN.test(modulePath);
};

export const normalizeIconImports = (iconImports: IconImportSpec[]): IconImportSpec[] => {
  const seen = new Set<string>();
  const uniqueIconImports: IconImportSpec[] = [];

  for (const iconImport of iconImports) {
    if (!isDeepIconImport(iconImport.modulePath)) {
      throw new Error(
        `Icon import must use a deep import path (e.g. "@mui/icons-material/Search"), ` +
          `but received barrel import "${iconImport.modulePath}" for "${iconImport.localName}". ` +
          `Barrel imports from "@mui/icons-material" defeat tree-shaking and must not be used.`
      );
    }
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

export const registerIconImport = (context: RenderContext, spec: IconImportSpec): string => {
  const exists = context.iconImports.some(
    (icon) => icon.localName === spec.localName && icon.modulePath === spec.modulePath
  );
  if (!exists) {
    context.iconImports.push(spec);
  }
  return spec.localName;
};

export const resolveIconColor = (element: ScreenElementIR): string | undefined => {
  return firstVectorColor(element) ?? firstTextColor(element) ?? element.fillColor;
};

export const ICON_FALLBACK_FILE_NAME = "icon-fallback-map.json";
const ICON_FALLBACK_DEFAULT_IMPORT_SPEC: IconImportSpec = {
  localName: "InfoOutlinedIcon",
  modulePath: "@mui/icons-material/InfoOutlined"
};
const ICON_FALLBACK_STYLE_TOKENS = new Set(["outlined", "rounded", "sharp", "twotone", "two", "tone", "filled"]);
const ICON_FALLBACK_MAX_PHRASE_LENGTH = 3;
const ICON_FALLBACK_FUZZY_STOPWORDS = new Set(["icon", "icons", "name", "real"]);
const ICON_FALLBACK_FUZZY_MAX_DISTANCE = 2;
const ICON_FALLBACK_FUZZY_MIN_CONFIDENCE = 0.8;
const ICON_FALLBACK_INPUT_NOISE_TOKENS = new Set(["ic", "icon", "icons", "mui", "material"]);
const ICON_FALLBACK_SIZE_TOKEN_PATTERN = /^\d+(?:px|dp|pt)?$/;

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

export const compileIconFallbackResolver = ({ map }: { map: IconFallbackMap }): IconFallbackResolver => {
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
  Close: ["x"],
  HelpOutline: ["questionmark", "hilfe"],
  HomeOutlined: ["homepage", "startseite"],
  PersonSearch: ["personensuche", "person_search", "search_person", "search person", "person search"],
  Forum: ["messenger", "speechbubble", "speech_bubble", "speech bubble"],
  Folder: ["document", "two documents", "two_documents"],
  EditOutlined: ["pencil"],
  Delete: ["trash"],
  Mail: ["postbox"],
  Add: ["plus"],
  Menu: ["hamburger"],
  Search: ["magnifier"],
  Settings: ["gear"],
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

export const ICON_FALLBACK_BUILTIN_RESOLVER: IconFallbackResolver = compileIconFallbackResolver({
  map: ICON_FALLBACK_BUILTIN_MAP
});

export const parseIconFallbackMapFile = ({ input }: { input: unknown }): IconFallbackMap | undefined => {
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

export const loadIconFallbackResolver = async ({
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

const isIconSizeToken = (token: string): boolean => {
  return ICON_FALLBACK_SIZE_TOKEN_PATTERN.test(token);
};

const toMeaningfulIconInputTokens = (tokens: string[]): string[] => {
  return tokens.filter((token) => {
    if (!token) {
      return false;
    }
    if (ICON_FALLBACK_INPUT_NOISE_TOKENS.has(token)) {
      return false;
    }
    if (ICON_FALLBACK_STYLE_TOKENS.has(token)) {
      return false;
    }
    if (isIconSizeToken(token)) {
      return false;
    }
    return true;
  });
};

const resolveIconLookupInput = ({
  rawInput
}: {
  rawInput: string;
}): {
  normalizedInput: string;
  normalizedTokens: string[];
  semanticInput: string;
  semanticTokens: string[];
} => {
  const normalizedInput = normalizeIconLookupText(rawInput);
  const normalizedTokens = toIconInputTokens(normalizedInput);
  const semanticTokens = toMeaningfulIconInputTokens(normalizedTokens);
  return {
    normalizedInput,
    normalizedTokens,
    semanticInput: semanticTokens.join(" "),
    semanticTokens
  };
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

export const toBoundedLevenshteinDistance = ({
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
      const deletion = (previous[col] ?? maxDistance + 1) + 1;
      const insertion = (current[col - 1] ?? maxDistance + 1) + 1;
      const substitution = (previous[col - 1] ?? maxDistance + 1) + (left[row - 1] === right[col - 1] ? 0 : 1);
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

const toFuzzyMatchConfidence = ({
  alias,
  term,
  distance
}: {
  alias: string;
  term: string;
  distance: number;
}): number => {
  const referenceLength = Math.max(alias.length, term.length, 1);
  return Math.max(0, 1 - distance / referenceLength);
};

export const toSequentialDeltas = (values: number[]): number[] => {
  const deltas: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    deltas.push(current - previous);
  }
  return deltas;
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
  const phraseTerms = normalizedInput.length > 0 ? [normalizedInput] : [];
  const terms = [...new Set([...phraseTerms, ...tokens])]
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !ICON_FALLBACK_FUZZY_STOPWORDS.has(term));
  const candidates: Array<{ entry: CompiledIconFallbackEntry; distance: number; tokenScore: number; confidence: number }> = [];
  for (const entry of resolver.entries) {
    let bestDistance: number | undefined;
    let bestTokenScore = 0;
    let bestConfidence = 0;
    for (const alias of entry.aliases) {
      for (const term of terms) {
        if (!term || Math.abs(alias.length - term.length) > 3) {
          continue;
        }
        const maxDistance = Math.max(
          1,
          Math.min(ICON_FALLBACK_FUZZY_MAX_DISTANCE, Math.floor(Math.min(alias.length, term.length) / 4))
        );
        const distance = toBoundedLevenshteinDistance({
          left: alias,
          right: term,
          maxDistance
        });
        if (distance === undefined) {
          continue;
        }
        const confidence = toFuzzyMatchConfidence({
          alias,
          term,
          distance
        });
        if (confidence <= ICON_FALLBACK_FUZZY_MIN_CONFIDENCE) {
          continue;
        }
        const tokenScore = alias.split(" ").length;
        if (
          bestDistance === undefined ||
          confidence > bestConfidence ||
          (confidence === bestConfidence &&
            (distance < bestDistance || (distance === bestDistance && tokenScore > bestTokenScore)))
        ) {
          bestDistance = distance;
          bestTokenScore = tokenScore;
          bestConfidence = confidence;
        }
      }
    }
    if (bestDistance !== undefined) {
      candidates.push({
        entry,
        distance: bestDistance,
        tokenScore: bestTokenScore,
        confidence: bestConfidence
      });
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((left, right) => {
    return (
      right.confidence - left.confidence ||
      left.distance - right.distance ||
      right.tokenScore - left.tokenScore ||
      left.entry.priority - right.entry.priority ||
      left.entry.iconName.localeCompare(right.entry.iconName)
    );
  });
  return candidates[0]?.entry;
};

export const resolveIconImportSpecFromCatalog = ({
  rawInput,
  resolver
}: {
  rawInput: string;
  resolver: IconFallbackResolver;
}): IconImportSpec => {
  const { normalizedInput, normalizedTokens, semanticInput, semanticTokens } = resolveIconLookupInput({
    rawInput
  });
  if (!normalizedInput) {
    return ICON_FALLBACK_DEFAULT_IMPORT_SPEC;
  }

  const exactLookupCandidates = [...new Set([semanticInput, normalizedInput].filter((value) => value.length > 0))];
  for (const lookupInput of exactLookupCandidates) {
    const exact = resolveFallbackIconByExactPhrase({
      normalizedInput: lookupInput,
      resolver
    });
    if (exact) {
      return exact.importSpec;
    }
  }

  const lookupInput = semanticInput || normalizedInput;
  const tokens = semanticTokens.length > 0 ? semanticTokens : normalizedTokens;

  const tokenBoundary = resolveFallbackIconByTokenBoundary({
    normalizedInput: lookupInput,
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
    normalizedInput: lookupInput,
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

export const resolveFallbackIconComponent = ({
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

const GRID_CLUSTER_TOLERANCE_PX = 18;
const GRID_MATRIX_MIN_CHILDREN = 4;
const GRID_EQUAL_ROW_MIN_CHILDREN = 3;
const GRID_EQUAL_WIDTH_CV_THRESHOLD = 0.14;
const GRID_EQUAL_WIDTH_DELTA_THRESHOLD_PX = 24;
const GRID_MATRIX_MIN_OCCUPANCY = 0.55;

interface GridLayoutDetection {
  mode: "matrix" | "equal-row" | "css-grid";
  columnCount: number;
  /** CSS Grid template columns (e.g., ["1fr", "2fr", "1fr"]). Only set for mode "css-grid". */
  gridTemplateColumns?: string[];
  /** CSS Grid template rows (e.g., ["auto", "1fr", "auto"]). Only set for mode "css-grid". */
  gridTemplateRows?: string[];
  /** Per-child grid placement. Key is child index in sorted order. */
  childSpans?: Map<number, { columnStart: number; columnEnd: number; rowStart: number; rowEnd: number }>;
}

const isFiniteNumber = (value: number | undefined): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

export const clusterAxisValues = ({ values, tolerance }: { values: number[]; tolerance: number }): number[] => {
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

export const toNearestClusterIndex = ({ value, clusters }: { value: number; clusters: number[] }): number => {
  if (clusters.length <= 1) {
    return 0;
  }
  const firstCluster = clusters[0];
  if (firstCluster === undefined) {
    return 0;
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(value - firstCluster);
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

export const detectGridLikeContainerLayout = (element: ScreenElementIR): GridLayoutDetection | null => {
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

/**
 * Detects CSS Grid layout patterns in grid-classified elements.
 * Identifies spanning cells, asymmetric columns, and named grid areas.
 * Returns CSS Grid metadata when the layout is better served by CSS Grid
 * than by MUI's flex-based Grid component.
 */
export const detectCssGridLayout = (element: ScreenElementIR): GridLayoutDetection | null => {
  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE");
  if (children.length < CSS_GRID_MIN_CHILDREN) {
    return null;
  }

  // Only detect CSS Grid for elements without Figma auto-layout (absolute positioning)
  // or for explicitly grid-classified elements. Flex-based layouts should stay as flex.
  const layoutMode = element.layoutMode ?? "NONE";
  if (layoutMode !== "NONE" && element.type !== "grid") {
    return null;
  }

  const positionedChildren = children.filter(
    (child) => isFiniteNumber(child.x) && isFiniteNumber(child.y) && isFiniteNumber(child.width) && isFiniteNumber(child.height)
  );
  if (positionedChildren.length < CSS_GRID_MIN_CHILDREN) {
    return null;
  }

  // Cluster children into row and column positions
  const rowClusters = clusterAxisValues({
    values: positionedChildren.map((child) => child.y ?? 0),
    tolerance: GRID_CLUSTER_TOLERANCE_PX
  });
  const columnClusters = clusterAxisValues({
    values: positionedChildren.map((child) => child.x ?? 0),
    tolerance: GRID_CLUSTER_TOLERANCE_PX
  });

  // Require at least 2 rows and 2 columns for a genuine 2D grid layout
  if (rowClusters.length < 2 || columnClusters.length < 2) {
    return null;
  }

  // Compute average column width from cluster positions
  const columnWidths: number[] = [];
  for (let i = 0; i < columnClusters.length; i++) {
    const clusterX = columnClusters[i] ?? 0;
    const nextClusterX = columnClusters[i + 1];
    if (nextClusterX !== undefined) {
      columnWidths.push(nextClusterX - clusterX);
    } else {
      // Last column — estimate from children in that column
      const childrenInColumn = positionedChildren.filter(
        (child) => toNearestClusterIndex({ value: child.x ?? 0, clusters: columnClusters }) === i
      );
      const maxWidth = Math.max(...childrenInColumn.map((c) => c.width ?? 0));
      columnWidths.push(maxWidth > 0 ? maxWidth : columnWidths.at(-1) ?? 100);
    }
  }

  // Check for asymmetric columns
  const avgColumnWidth = columnWidths.reduce((sum, w) => sum + w, 0) / columnWidths.length;
  const widthVariance = columnWidths.reduce((sum, w) => sum + (w - avgColumnWidth) ** 2, 0) / columnWidths.length;
  const widthCv = avgColumnWidth > 0 ? Math.sqrt(widthVariance) / avgColumnWidth : 0;
  const isAsymmetric = widthCv > CSS_GRID_ASYMMETRIC_CV_THRESHOLD;

  // Check for spanning children
  const childSpans = new Map<number, { columnStart: number; columnEnd: number; rowStart: number; rowEnd: number }>();
  let hasSpanning = false;

  for (let childIdx = 0; childIdx < positionedChildren.length; childIdx++) {
    const child = positionedChildren[childIdx];
    if (!child) {
      continue;
    }
    const childX = child.x ?? 0;
    const childY = child.y ?? 0;
    const childWidth = child.width ?? 0;
    const childHeight = child.height ?? 0;
    const childRight = childX + childWidth;
    const childBottom = childY + childHeight;

    const colStart = toNearestClusterIndex({ value: childX, clusters: columnClusters });
    const rowStart = toNearestClusterIndex({ value: childY, clusters: rowClusters });

    // Determine column span by checking how many column clusters this child covers
    let colEnd = colStart + 1;
    for (let c = colStart + 1; c < columnClusters.length; c++) {
      const clusterCenter = columnClusters[c] ?? 0;
      if (childRight > clusterCenter + GRID_CLUSTER_TOLERANCE_PX) {
        colEnd = c + 1;
      }
    }
    // If child width significantly exceeds average column width, it spans
    if (childWidth > avgColumnWidth * CSS_GRID_SPAN_WIDTH_RATIO && colEnd - colStart <= 1) {
      colEnd = Math.min(colStart + Math.round(childWidth / avgColumnWidth), columnClusters.length);
    }

    // Determine row span
    let rowEnd = rowStart + 1;
    for (let r = rowStart + 1; r < rowClusters.length; r++) {
      const clusterCenter = rowClusters[r] ?? 0;
      if (childBottom > clusterCenter + GRID_CLUSTER_TOLERANCE_PX) {
        rowEnd = r + 1;
      }
    }
    // Check row spanning by height
    const avgRowHeight = rowClusters.length > 1
      ? ((rowClusters.at(-1) ?? 0) - (rowClusters[0] ?? 0)) / (rowClusters.length - 1)
      : childHeight;
    if (childHeight > avgRowHeight * CSS_GRID_SPAN_HEIGHT_RATIO && rowEnd - rowStart <= 1 && avgRowHeight > 0) {
      rowEnd = Math.min(rowStart + Math.round(childHeight / avgRowHeight), rowClusters.length);
    }

    if (colEnd - colStart > 1 || rowEnd - rowStart > 1) {
      hasSpanning = true;
    }

    // Find original index in children array
    const originalIndex = children.indexOf(child);
    childSpans.set(originalIndex >= 0 ? originalIndex : childIdx, {
      columnStart: colStart + 1,
      columnEnd: colEnd + 1,
      rowStart: rowStart + 1,
      rowEnd: rowEnd + 1
    });
  }

  // Also check for named grid areas from child names
  const hasNamedAreas = children.some((child) => {
    const childName = child.name.toLowerCase();
    return childName.includes("grid-area") || childName.includes("gridarea") ||
           childName.includes("header") || childName.includes("sidebar") || childName.includes("footer") ||
           (child.cssGridHints?.gridArea !== undefined);
  });

  // Only use CSS Grid if there's a reason to prefer it over MUI Grid
  if (!hasSpanning && !isAsymmetric && !hasNamedAreas) {
    return null;
  }

  // Build gridTemplateColumns from column widths as fr units
  const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
  const gridTemplateColumns = columnWidths.map((w) => {
    const ratio = totalWidth > 0 ? w / totalWidth : 1 / columnWidths.length;
    const fr = Math.max(1, Math.round(ratio * columnClusters.length));
    return `${fr}fr`;
  });

  // Build gridTemplateRows — use "auto" for each detected row
  const gridTemplateRows = rowClusters.map(() => "auto");

  return {
    mode: "css-grid",
    columnCount: columnClusters.length,
    gridTemplateColumns,
    gridTemplateRows,
    childSpans
  };
};

export const createDeterministicScreenFile = (
  screen: ScreenIR,
  options?: {
    routePathByScreenId?: Map<string, string> | Record<string, string>;
    generationLocale?: string;
    formHandlingMode?: WorkspaceFormHandlingMode;
    themeComponentDefaults?: ThemeComponentDefaults;
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
    enablePatternExtraction: false,
    ...(options?.themeComponentDefaults ? { themeComponentDefaults: options.themeComponentDefaults } : {}),
    ...(options?.generationLocale !== undefined ? { generationLocale: options.generationLocale } : {}),
    ...(options?.formHandlingMode !== undefined ? { formHandlingMode: options.formHandlingMode } : {})
  }).file;
};

export const createDeterministicAppFile = (
  screens: ScreenIR[],
  options?: {
    routerMode?: WorkspaceRouterMode;
    includeThemeModeToggle?: boolean;
  }
): GeneratedFile => {
  const identitiesByScreenId = buildScreenArtifactIdentities(screens);
  return {
    path: "src/App.tsx",
    content: makeAppFile({
      screens,
      identitiesByScreenId,
      ...(options?.routerMode !== undefined ? { routerMode: options.routerMode } : {}),
      ...(options?.includeThemeModeToggle !== undefined
        ? { includeThemeModeToggle: options.includeThemeModeToggle }
        : {})
    })
  };
};

export const flattenElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const all: ScreenElementIR[] = [];
  const stack = [...elements];
  const visited = new Set<ScreenElementIR>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    all.push(current);
    for (const child of current.children ?? []) {
      stack.push(child);
    }
  }
  return all;
};

export { normalizeInputSemanticText } from "./generator-forms.js";
