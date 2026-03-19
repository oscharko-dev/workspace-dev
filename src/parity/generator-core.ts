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
  ScreenSimplificationMetric,
  ScreenResponsiveLayoutOverridesByBreakpoint,
  SimplificationMetrics,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { validateDesignIR } from "./types.js";
import { BUILTIN_ICON_FALLBACK_CATALOG, ICON_FALLBACK_MAP_VERSION } from "./icon-fallback-catalog.js";
import { ensureTsxName } from "./path-utils.js";
import { DESIGN_TYPOGRAPHY_VARIANTS } from "./typography-tokens.js";
import { WorkflowError } from "./workflow-error.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import {
  applyDesignSystemMappingsToGeneratedTsx,
  getDefaultDesignSystemConfigPath,
  loadDesignSystemConfigFile
} from "../design-system.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
export { buildScreenArtifactIdentities, toComponentName, toDeterministicScreenPath } from "./generator-artifacts.js";
export type { ScreenArtifactIdentity } from "./generator-artifacts.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import type { ScreenArtifactIdentity } from "./generator-artifacts.js";
export {
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey,
  collectThemeSxSampleFromEntries,
  collectThemeDefaultMatchedSxKeys,
  createDeterministicThemeFile,
  deriveThemeComponentDefaultsFromIr
} from "./generator-design-system.js";
export type {
  ThemeComponentDefaults,
  ThemeSxStyleValue,
  ThemeSxComponentStyleOverrides,
  ThemeSxSample,
  ThemeSxSampleCollector
} from "./generator-design-system.js";
import { deriveThemeComponentDefaultsFromIr } from "./generator-design-system.js";
import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";
export { createGeneratorContext } from "./generator-context.js";
export type {
  GeneratorContext,
  GeneratorConfig,
  GenerateArtifactsRuntimeAdapters as GeneratorRuntimeAdapters,
  MetricsAccumulator,
  WarningCollector,
  CreateGeneratorContextInput
} from "./generator-context.js";
import type { GeneratorContext } from "./generator-context.js";
export {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferLandmarkRole,
  isDecorativeImageElement,
  isDecorativeElement,
  inferHeadingComponentByNodeId,
  resolveBackgroundHexForText,
  pushLowContrastWarning
} from "./generator-a11y.js";
export type { AccessibilityWarning } from "./generator-a11y.js";
import {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";
import type { AccessibilityWarning } from "./generator-a11y.js";
import {
  A11Y_NAVIGATION_HINTS,
  A11Y_IMAGE_DECORATIVE_HINTS,
  HEADING_NAME_HINTS
} from "./generator-a11y.js";
import {
  literal,
  normalizeOpacityForSx,
  normalizeHexColor,
  normalizeFontFamily,
  toLetterSpacingEm,
  toRgbaColor,
  isLikelyErrorRedColor,
  DEFAULT_SPACING_BASE,
  resolveFormHandlingMode,
  indentBlock,
  toElementSx,
  firstText,
  firstTextColor,
  firstVectorColor,
  collectTextNodes,
  escapeXmlText,
  collectVectorPaths,
  renderElement,
  fallbackThemeFile,
  fallbackScreenFile,
  makeErrorBoundaryFile,
  makeScreenSkeletonFile,
  makeAppFile,
  renderFallbackIconExpression,
  collectRenderedItems
} from "./generator-templates.js";
import type {
  RenderedItem,
  DetectedTabInterfacePattern,
  DetectedDialogOverlayPattern,
  DialogActionModel
} from "./generator-templates.js";

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  iconMapFilePath?: string;
  designSystemFilePath?: string;
  imageAssetMap?: Record<string, string>;
  /** Optional pre-built GeneratorContext for dependency injection in tests. */
  context?: GeneratorContext;
  generationLocale?: string;
  routerMode?: WorkspaceRouterMode;
  formHandlingMode?: WorkspaceFormHandlingMode;
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
export type ValidationFieldType =
  | "email"
  | "password"
  | "tel"
  | "number"
  | "date"
  | "url"
  | "search"
  | "iban"
  | "plz"
  | "credit_card";
export type ResolvedFormHandlingMode = WorkspaceFormHandlingMode;
export type HeadingComponent = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type LandmarkRole = "navigation";

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

const accumulateSimplificationStats = ({
  target,
  source
}: {
  target: SimplificationMetrics;
  source: SimplificationMetrics;
}): void => {
  target.removedEmptyNodes += source.removedEmptyNodes;
  target.promotedSingleChild += source.promotedSingleChild;
  target.promotedGroupMultiChild += source.promotedGroupMultiChild;
  target.spacingMerges += source.spacingMerges;
  target.guardedSkips += source.guardedSkips;
};

const normalizeSpacingValues = (
  spacing: ScreenElementIR["margin"] | ScreenElementIR["padding"] | undefined
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

export const isSemanticIconWrapper = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  return loweredName.includes("buttonendicon") || loweredName.includes("expandiconwrapper");
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

  const blockedByGuardrails = Boolean(
    element.prototypeNavigation ||
      isIconLikeNode(element) ||
      isSemanticIconWrapper(element) ||
      hasPromotionBlockingVisualStyle(element) ||
      element.text?.trim() ||
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

const SHARED_SX_MIN_OCCURRENCES = 3;
const SHARED_SX_IDENTIFIER_PREFIX = "sharedSxStyle";
const SX_ATTRIBUTE_PREFIX = "sx={{";

interface SxAttributeOccurrence {
  startIndex: number;
  endIndexExclusive: number;
  body: string;
  normalizedBody: string;
}

const findSxBodyEndIndex = ({
  source,
  startIndex
}: {
  source: string;
  startIndex: number;
}): number | undefined => {
  let depth = 1;
  let activeQuote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === undefined) {
      continue;
    }

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === activeQuote) {
        activeQuote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      activeQuote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
};

const collectSxAttributeOccurrences = (source: string): SxAttributeOccurrence[] => {
  const occurrences: SxAttributeOccurrence[] = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const startIndex = source.indexOf(SX_ATTRIBUTE_PREFIX, searchFrom);
    if (startIndex < 0) {
      break;
    }

    const bodyStartIndex = startIndex + SX_ATTRIBUTE_PREFIX.length;
    const bodyEndIndex = findSxBodyEndIndex({
      source,
      startIndex: bodyStartIndex
    });
    if (bodyEndIndex === undefined) {
      searchFrom = bodyStartIndex;
      continue;
    }

    let expressionEndIndex = bodyEndIndex + 1;
    while (expressionEndIndex < source.length && /\s/.test(source[expressionEndIndex] ?? "")) {
      expressionEndIndex += 1;
    }
    if (source[expressionEndIndex] !== "}") {
      searchFrom = bodyStartIndex;
      continue;
    }

    const endIndexExclusive = expressionEndIndex + 1;
    const body = source.slice(bodyStartIndex, bodyEndIndex);
    const normalizedBody = body.trim();
    if (normalizedBody.length > 0) {
      occurrences.push({
        startIndex,
        endIndexExclusive,
        body,
        normalizedBody
      });
    }

    searchFrom = endIndexExclusive;
  }

  return occurrences;
};

const collectIdentifiersFromSource = (source: string): Set<string> => {
  const identifiers = new Set<string>();
  for (const match of source.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    const identifier = match[0];
    if (identifier) {
      identifiers.add(identifier);
    }
  }
  return identifiers;
};

const allocateSharedSxConstantName = ({
  preferredNumber,
  reservedNames,
  knownIdentifiers
}: {
  preferredNumber: number;
  reservedNames: Set<string>;
  knownIdentifiers: Set<string>;
}): {
  name: string;
  nextPreferredNumber: number;
} => {
  let suffix = preferredNumber;
  for (;;) {
    const candidate = `${SHARED_SX_IDENTIFIER_PREFIX}${suffix}`;
    if (!reservedNames.has(candidate) && !knownIdentifiers.has(candidate)) {
      reservedNames.add(candidate);
      return {
        name: candidate,
        nextPreferredNumber: suffix + 1
      };
    }
    suffix += 1;
  }
};

export const extractSharedSxConstantsFromScreenContent = (source: string): string => {
  const occurrences = collectSxAttributeOccurrences(source);
  if (occurrences.length < SHARED_SX_MIN_OCCURRENCES) {
    return source;
  }

  const patternStats = new Map<
    string,
    {
      count: number;
      firstStartIndex: number;
      normalizedBody: string;
    }
  >();
  for (const occurrence of occurrences) {
    const existing = patternStats.get(occurrence.normalizedBody);
    if (!existing) {
      patternStats.set(occurrence.normalizedBody, {
        count: 1,
        firstStartIndex: occurrence.startIndex,
        normalizedBody: occurrence.normalizedBody
      });
      continue;
    }
    existing.count += 1;
  }

  const selectedPatterns = Array.from(patternStats.values())
    .filter((pattern) => pattern.count >= SHARED_SX_MIN_OCCURRENCES)
    .sort((left, right) => left.firstStartIndex - right.firstStartIndex);

  if (selectedPatterns.length === 0) {
    return source;
  }

  const knownIdentifiers = collectIdentifiersFromSource(source);
  const reservedNames = new Set<string>();
  let preferredNumber = 1;
  const constantNameByBody = new Map<string, string>();
  const constantDefinitions: Array<{ name: string; normalizedBody: string }> = [];
  for (const pattern of selectedPatterns) {
    const { name, nextPreferredNumber } = allocateSharedSxConstantName({
      preferredNumber,
      reservedNames,
      knownIdentifiers
    });
    preferredNumber = nextPreferredNumber;
    constantNameByBody.set(pattern.normalizedBody, name);
    constantDefinitions.push({
      name,
      normalizedBody: pattern.normalizedBody
    });
  }

  let rewrittenContent = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    rewrittenContent += source.slice(cursor, occurrence.startIndex);
    const constantName = constantNameByBody.get(occurrence.normalizedBody);
    if (constantName) {
      rewrittenContent += `sx={${constantName}}`;
    } else {
      rewrittenContent += source.slice(occurrence.startIndex, occurrence.endIndexExclusive);
    }
    cursor = occurrence.endIndexExclusive;
  }
  rewrittenContent += source.slice(cursor);

  const exportIndex = rewrittenContent.indexOf("export default function ");
  if (exportIndex < 0) {
    return rewrittenContent;
  }

  const constantsBlock = constantDefinitions
    .map((definition) => `const ${definition.name} = { ${definition.normalizedBody} };`)
    .join("\n");
  const beforeExport = rewrittenContent.slice(0, exportIndex).trimEnd();
  const fromExport = rewrittenContent.slice(exportIndex);

  return `${beforeExport}\n\n${constantsBlock}\n\n${fromExport}`;
};

const PATTERN_SIMILARITY_THRESHOLD = 0.8;
const PATTERN_MIN_OCCURRENCES = 3;
const PATTERN_MIN_SUBTREE_NODE_COUNT = 3;
const EXTRACTION_CANDIDATE_TYPES = new Set<ScreenElementIR["type"]>([
  "container",
  "card",
  "paper",
  "stack",
  "grid",
  "list",
  "table"
]);
const EXTRACTION_FORBIDDEN_TYPES = new Set<ScreenElementIR["type"]>([
  "input",
  "button",
  "chip",
  "switch",
  "checkbox",
  "radio",
  "select",
  "slider",
  "rating",
  "tab",
  "dialog",
  "stepper",
  "navigation",
  "appbar",
  "breadcrumbs",
  "drawer"
]);

const emptyPatternExtractionPlan = (): PatternExtractionPlan => ({
  componentFiles: [],
  contextFiles: [],
  componentImports: [],
  invocationByRootNodeId: new Map<string, PatternExtractionInvocation>(),
  patternStatePlan: {}
});

const toSortedChildrenForExtraction = ({
  children,
  layoutMode,
  generationLocale
}: {
  children: ScreenElementIR[];
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  generationLocale: string;
}): ScreenElementIR[] => {
  return sortChildren(children, layoutMode, { generationLocale });
};

const collectPathNodeMapForExtraction = ({
  root,
  generationLocale
}: {
  root: ScreenElementIR;
  generationLocale: string;
}): Map<string, ScreenElementIR> => {
  const byPath = new Map<string, ScreenElementIR>();
  const visit = (node: ScreenElementIR, pathToken: string): void => {
    byPath.set(pathToken, node);
    const children = toSortedChildrenForExtraction({
      children: node.children ?? [],
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    children.forEach((child, index) => {
      const nextPath = pathToken.length > 0 ? `${pathToken}.${index}` : String(index);
      visit(child, nextPath);
    });
  };
  visit(root, "");
  return byPath;
};

const collectSubtreeNodeIdsForExtraction = (
  root: ScreenElementIR,
  visited: Set<ScreenElementIR> = new Set()
): Set<string> => {
  if (visited.has(root)) {
    return new Set<string>();
  }
  visited.add(root);
  const nodeIds = new Set<string>([root.id]);
  for (const child of root.children ?? []) {
    const nested = collectSubtreeNodeIdsForExtraction(child, visited);
    for (const nodeId of nested) {
      nodeIds.add(nodeId);
    }
  }
  return nodeIds;
};

const hasForbiddenExtractionSignals = (
  node: ScreenElementIR,
  visited: Set<ScreenElementIR> = new Set()
): boolean => {
  if (visited.has(node)) {
    return false;
  }
  visited.add(node);
  if (EXTRACTION_FORBIDDEN_TYPES.has(node.type) || Boolean(node.prototypeNavigation) || Boolean(node.variantMapping)) {
    return true;
  }
  return (node.children ?? []).some((child) => hasForbiddenExtractionSignals(child, visited));
};

const hasTextOrImageDescendants = (node: ScreenElementIR, visited: Set<ScreenElementIR> = new Set()): boolean => {
  if (visited.has(node)) {
    return false;
  }
  visited.add(node);
  if (node.type === "text" || node.type === "image") {
    return true;
  }
  return (node.children ?? []).some((child) => hasTextOrImageDescendants(child, visited));
};

const computeStructuralSignature = ({
  root,
  generationLocale
}: {
  root: ScreenElementIR;
  generationLocale: string;
}): Set<string> => {
  const signature = new Set<string>();
  const visit = (node: ScreenElementIR, depth: number): void => {
    const children = toSortedChildrenForExtraction({
      children: node.children ?? [],
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    const bucketedChildrenCount = Math.min(6, children.length);
    signature.add(`n:${depth}:${node.type}:${node.nodeType}:${bucketedChildrenCount}`);
    if (node.layoutMode) {
      signature.add(`layout:${depth}:${node.layoutMode}`);
    }
    if (node.type === "text") {
      signature.add(`text:${depth}`);
    }
    if (node.type === "image") {
      signature.add(`image:${depth}`);
    }
    children.forEach((child, index) => {
      const bucketedIndex = Math.min(index, 4);
      signature.add(`e:${depth}:${node.type}>${child.type}:${bucketedIndex}`);
      visit(child, depth + 1);
    });
  };
  visit(root, 0);
  return signature;
};

const computeSubtreeSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersectionCount = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersectionCount += 1;
    }
  }
  const unionCount = left.size + right.size - intersectionCount;
  if (unionCount <= 0) {
    return 0;
  }
  return intersectionCount / unionCount;
};

const hasIntersectionWithSet = ({
  values,
  targets
}: {
  values: Set<string>;
  targets: Set<string>;
}): boolean => {
  for (const value of values) {
    if (targets.has(value)) {
      return true;
    }
  }
  return false;
};

const toExtractionPropName = ({
  rawName,
  fallback
}: {
  rawName: string;
  fallback: string;
}): string => {
  const words = rawName
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (words.length === 0) {
    return fallback;
  }
  const camelCased = words
    .map((word, index) => {
      const lowered = word.toLowerCase();
      if (index === 0) {
        return lowered;
      }
      return `${lowered.charAt(0).toUpperCase()}${lowered.slice(1)}`;
    })
    .join("");
  if (!camelCased) {
    return fallback;
  }
  if (/^\d/.test(camelCased)) {
    return `${fallback}${camelCased}`;
  }
  return camelCased;
};

const toUniquePropName = ({
  candidate,
  used
}: {
  candidate: string;
  used: Set<string>;
}): string => {
  let nextName = candidate;
  let suffix = 2;
  while (used.has(nextName)) {
    nextName = `${candidate}${suffix}`;
    suffix += 1;
  }
  used.add(nextName);
  return nextName;
};

const toTextValueForExtraction = (node: ScreenElementIR | undefined): string | undefined => {
  if (!node || node.type !== "text") {
    return undefined;
  }
  const normalizedText = node.text?.trim();
  if (normalizedText && normalizedText.length > 0) {
    return normalizedText;
  }
  const normalizedName = node.name.trim();
  return normalizedName.length > 0 ? normalizedName : undefined;
};

const toImageSourceForExtraction = ({
  node,
  imageAssetMap
}: {
  node: ScreenElementIR | undefined;
  imageAssetMap: Record<string, string>;
}): string | undefined => {
  if (!node || node.type !== "image") {
    return undefined;
  }
  const mappedSource = imageAssetMap[node.id];
  if (typeof mappedSource === "string" && mappedSource.trim().length > 0) {
    return mappedSource.trim();
  }
  const fallbackLabel = resolveElementA11yLabel({ element: node, fallback: "Image" });
  return toDeterministicImagePlaceholderSrc({
    element: node,
    label: fallbackLabel
  });
};

const inferDynamicPropsFromCluster = ({
  members,
  imageAssetMap
}: {
  members: ExtractionCandidate[];
  imageAssetMap: Record<string, string>;
}): DynamicPropBinding[] => {
  const prototype = members[0];
  if (!prototype) {
    return [];
  }
  const usedPropNames = new Set<string>(["sx"]);
  const bindings: DynamicPropBinding[] = [];
  const sortedPrototypePaths = Array.from(prototype.pathNodeMap.keys()).sort((left, right) => left.localeCompare(right));

  for (const pathToken of sortedPrototypePaths) {
    const prototypeNode = prototype.pathNodeMap.get(pathToken);
    if (!prototypeNode) {
      continue;
    }

    if (prototypeNode.type === "text") {
      const valuesByRootNodeId = new Map<string, string | undefined>();
      const distinctValues = new Set<string>();
      let optional = false;
      for (const member of members) {
        const memberNode = member.pathNodeMap.get(pathToken);
        const value = toTextValueForExtraction(memberNode);
        if (value === undefined) {
          optional = true;
        } else {
          distinctValues.add(value);
        }
        valuesByRootNodeId.set(member.root.id, value);
      }
      if (distinctValues.size <= 1 && !optional) {
        continue;
      }
      const propName = toUniquePropName({
        candidate: toExtractionPropName({
          rawName: `${prototypeNode.name} text`,
          fallback: "textValue"
        }),
        used: usedPropNames
      });
      bindings.push({
        kind: "text",
        path: pathToken,
        propName,
        optional,
        placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
        valuesByRootNodeId
      });
      continue;
    }

    if (prototypeNode.type === "image") {
      const sourceValuesByRootNodeId = new Map<string, string | undefined>();
      const sourceDistinctValues = new Set<string>();
      let sourceOptional = false;
      const altValuesByRootNodeId = new Map<string, string | undefined>();
      const altDistinctValues = new Set<string>();
      let altOptional = false;

      for (const member of members) {
        const memberNode = member.pathNodeMap.get(pathToken);
        const sourceValue = toImageSourceForExtraction({
          node: memberNode,
          imageAssetMap
        });
        if (sourceValue === undefined) {
          sourceOptional = true;
        } else {
          sourceDistinctValues.add(sourceValue);
        }
        sourceValuesByRootNodeId.set(member.root.id, sourceValue);

        const altValue = memberNode
          ? resolveElementA11yLabel({
              element: memberNode,
              fallback: "Image"
            })
          : undefined;
        if (altValue === undefined) {
          altOptional = true;
        } else {
          altDistinctValues.add(altValue);
        }
        altValuesByRootNodeId.set(member.root.id, altValue);
      }

      if (sourceDistinctValues.size > 1 || sourceOptional) {
        const propName = toUniquePropName({
          candidate: toExtractionPropName({
            rawName: `${prototypeNode.name} src`,
            fallback: "imageSrc"
          }),
          used: usedPropNames
        });
        bindings.push({
          kind: "image_src",
          path: pathToken,
          propName,
          optional: sourceOptional,
          placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
          valuesByRootNodeId: sourceValuesByRootNodeId
        });
      }

      if (altDistinctValues.size > 1 || altOptional) {
        const propName = toUniquePropName({
          candidate: toExtractionPropName({
            rawName: `${prototypeNode.name} alt`,
            fallback: "imageAlt"
          }),
          used: usedPropNames
        });
        bindings.push({
          kind: "image_alt",
          path: pathToken,
          propName,
          optional: altOptional,
          placeholder: `__PATTERN_PROP_${propName.toUpperCase()}__`,
          valuesByRootNodeId: altValuesByRootNodeId
        });
      }
    }
  }

  return bindings;
};

const cloneElementForExtraction = (element: ScreenElementIR): ScreenElementIR => {
  return {
    ...element,
    ...(element.children ? { children: element.children.map((child) => cloneElementForExtraction(child)) } : {})
  };
};

const injectRootSxPropForExtractedComponent = (renderedRoot: string): string | undefined => {
  const sxStartIndex = renderedRoot.indexOf(SX_ATTRIBUTE_PREFIX);
  if (sxStartIndex < 0) {
    return undefined;
  }
  const bodyStartIndex = sxStartIndex + SX_ATTRIBUTE_PREFIX.length;
  const bodyEndIndex = findSxBodyEndIndex({
    source: renderedRoot,
    startIndex: bodyStartIndex
  });
  if (bodyEndIndex === undefined) {
    return undefined;
  }
  if (renderedRoot[bodyEndIndex + 1] !== "}") {
    return undefined;
  }
  const body = renderedRoot.slice(bodyStartIndex, bodyEndIndex).trim();
  const replacement = `sx={[{ ${body} }, sx]}`;
  return `${renderedRoot.slice(0, sxStartIndex)}${replacement}${renderedRoot.slice(bodyEndIndex + 2)}`;
};

export const toPatternContextProviderName = (screenComponentName: string): string => {
  return `${screenComponentName}PatternContextProvider`;
};

export const toPatternContextHookName = (screenComponentName: string): string => {
  return `use${screenComponentName}PatternContext`;
};

const toPatternContextStateTypeName = (screenComponentName: string): string => {
  return `${screenComponentName}PatternContextState`;
};

const toPatternClusterStateTypeName = (componentName: string): string => {
  return `${componentName}State`;
};

export const toFormContextProviderName = (screenComponentName: string): string => {
  return `${screenComponentName}FormContextProvider`;
};

export const toFormContextHookName = (screenComponentName: string): string => {
  return `use${screenComponentName}FormContext`;
};

const buildScreenPatternStatePlan = ({
  screenComponentName,
  clusters
}: {
  screenComponentName: string;
  clusters: PatternCluster[];
}): ScreenPatternStatePlan => {
  const contextEnabledClusters = clusters
    .filter((cluster) => cluster.propBindings.length > 0)
    .sort((left, right) => left.componentName.localeCompare(right.componentName));
  if (contextEnabledClusters.length === 0) {
    return {};
  }

  const clusterSpecs: PatternContextClusterStateSpec[] = contextEnabledClusters.map((cluster) => {
    const sortedBindings = [...cluster.propBindings].sort((left, right) => left.propName.localeCompare(right.propName));
    const sortedMembers = [...cluster.members].sort((left, right) => left.root.id.localeCompare(right.root.id));
    const entries = sortedMembers.map((member) => {
      const values = Object.fromEntries(
        sortedBindings.map((binding) => [binding.propName, binding.valuesByRootNodeId.get(member.root.id)])
      ) as Record<string, string | undefined>;
      return {
        instanceId: member.root.id,
        values
      };
    });
    return {
      componentName: cluster.componentName,
      stateTypeName: toPatternClusterStateTypeName(cluster.componentName),
      propBindings: sortedBindings,
      entries
    };
  });

  const providerName = toPatternContextProviderName(screenComponentName);
  const hookName = toPatternContextHookName(screenComponentName);
  const stateTypeName = toPatternContextStateTypeName(screenComponentName);
  const contextVarName = `${screenComponentName}PatternContext`;
  const contextStateLiteral = JSON.stringify(
    Object.fromEntries(
      clusterSpecs.map((clusterSpec) => [
        clusterSpec.componentName,
        Object.fromEntries(clusterSpec.entries.map((entry) => [entry.instanceId, entry.values]))
      ])
    ),
    null,
    2
  );
  const emptyStateLiteral = JSON.stringify(
    Object.fromEntries(clusterSpecs.map((clusterSpec) => [clusterSpec.componentName, {}])),
    null,
    2
  );
  const clusterInterfaces = clusterSpecs
    .map((clusterSpec) => {
      const entries = clusterSpec.propBindings
        .map((binding) => `  ${binding.propName}${binding.optional ? "?" : ""}: string;`)
        .join("\n");
      return `export interface ${clusterSpec.stateTypeName} {\n${entries}\n}`;
    })
    .join("\n\n");
  const contextInterfaceEntries = clusterSpecs
    .map((clusterSpec) => `  ${clusterSpec.componentName}: Record<string, ${clusterSpec.stateTypeName}>;`)
    .join("\n");
  const providerPropsName = `${providerName}Props`;
  const contextSource = `/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

${clusterInterfaces}

export interface ${stateTypeName} {
${contextInterfaceEntries}
}

const emptyPatternState: ${stateTypeName} = ${emptyStateLiteral};

const ${contextVarName} = createContext<${stateTypeName}>(emptyPatternState);

interface ${providerPropsName} {
  initialState: ${stateTypeName};
  children: ReactNode;
}

export function ${providerName}({ initialState, children }: ${providerPropsName}) {
  return <${contextVarName}.Provider value={initialState}>{children}</${contextVarName}.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ${hookName} = (): ${stateTypeName} => {
  return useContext(${contextVarName});
};
`;

  return {
    contextFileSpec: {
      file: {
        path: path.posix.join("src", "context", ensureTsxName(`${screenComponentName}PatternContext`)),
        content: contextSource
      },
      providerName,
      hookName,
      stateTypeName,
      importPath: `../context/${screenComponentName}PatternContext`,
      initialStateLiteral: contextStateLiteral,
      contextEnabledComponentNames: new Set(clusterSpecs.map((clusterSpec) => clusterSpec.componentName))
    }
  };
};

const buildExtractedComponentFile = ({
  cluster,
  patternStatePlan,
  screen,
  generationLocale,
  spacingBase,
  tokens,
  iconResolver,
  imageAssetMap,
  routePathByScreenId,
  mappingByNodeId,
  pageBackgroundColorNormalized,
  themeComponentDefaults,
  responsiveTopLevelLayoutOverrides
}: {
  cluster: PatternCluster;
  patternStatePlan: ScreenPatternStatePlan;
  screen: ScreenIR;
  generationLocale: string;
  spacingBase: number;
  tokens: DesignTokens | undefined;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  themeComponentDefaults?: ThemeComponentDefaults;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}): GeneratedFile | undefined => {
  const prototypeRoot = cloneElementForExtraction(cluster.prototype.root);
  const placeholderImageAssetMap: Record<string, string> = {
    ...imageAssetMap
  };
  const pathNodeMap = collectPathNodeMapForExtraction({
    root: prototypeRoot,
    generationLocale
  });

  for (const binding of cluster.propBindings) {
    const node = pathNodeMap.get(binding.path);
    if (!node) {
      continue;
    }
    if (binding.kind === "text" && node.type === "text") {
      node.text = binding.placeholder;
      continue;
    }
    if (binding.kind === "image_src" && node.type === "image") {
      placeholderImageAssetMap[node.id] = binding.placeholder;
      continue;
    }
    if (binding.kind === "image_alt" && node.type === "image") {
      node.name = binding.placeholder;
    }
  }

  const headingComponentByNodeId = inferHeadingComponentByNodeId([prototypeRoot]);
  const typographyVariantByNodeId = resolveTypographyVariantByNodeId({
    elements: [prototypeRoot],
    tokens
  });
  const componentRenderContext: RenderContext = {
    screenId: screen.id,
    screenName: `${screen.name}:${cluster.componentName}`,
    generationLocale,
    formHandlingMode: "legacy_use_state",
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
    muiImports: new Set<string>(),
    iconImports: [],
    iconResolver,
    imageAssetMap: placeholderImageAssetMap,
    routePathByScreenId,
    usesRouterLink: false,
    usesNavigateHandler: false,
    prototypeNavigationRenderedCount: 0,
    mappedImports: [],
    spacingBase,
    ...(tokens ? { tokens } : {}),
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>(),
    emittedAccessibilityWarningKeys: new Set<string>(),
    pageBackgroundColorNormalized,
    ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
    ...(responsiveTopLevelLayoutOverrides ? { responsiveTopLevelLayoutOverrides } : {}),
    extractionInvocationByNodeId: new Map<string, PatternExtractionInvocation>()
  };

  const renderedRoot = renderElement(prototypeRoot, 2, cluster.prototype.parent, componentRenderContext);
  if (!renderedRoot || !renderedRoot.trim()) {
    return undefined;
  }
  if (
    componentRenderContext.fields.length > 0 ||
    componentRenderContext.accordions.length > 0 ||
    componentRenderContext.tabs.length > 0 ||
    componentRenderContext.dialogs.length > 0 ||
    componentRenderContext.usesNavigateHandler
  ) {
    return undefined;
  }

  let renderedComponentBody = renderedRoot;
  for (const binding of cluster.propBindings) {
    const placeholderLiteral = literal(binding.placeholder);
    if (binding.kind === "text") {
      renderedComponentBody = renderedComponentBody.split(`{${placeholderLiteral}}`).join(`{${binding.propName}}`);
      continue;
    }
    if (binding.kind === "image_src") {
      renderedComponentBody = renderedComponentBody
        .split(`src={${placeholderLiteral}}`)
        .join(`src={${binding.propName}}`);
      continue;
    }
    renderedComponentBody = renderedComponentBody
      .split(`alt={${placeholderLiteral}}`)
      .join(`alt={${binding.propName}}`);
  }

  const renderedWithSx = injectRootSxPropForExtractedComponent(renderedComponentBody);
  if (!renderedWithSx) {
    return undefined;
  }

  const contextFileSpec = patternStatePlan.contextFileSpec;
  const patternContextSpec =
    contextFileSpec &&
    contextFileSpec.contextEnabledComponentNames.has(cluster.componentName) &&
    cluster.propBindings.length > 0
      ? contextFileSpec
      : undefined;
  const usesPatternContext = patternContextSpec !== undefined;
  const sortedMuiImports = [...componentRenderContext.muiImports].sort((left, right) => left.localeCompare(right));
  if (sortedMuiImports.length === 0) {
    return undefined;
  }
  const iconImports = normalizeIconImports(componentRenderContext.iconImports)
    .map((iconImport) => `import ${iconImport.localName} from "${iconImport.modulePath}";`)
    .join("\n");
  const mappedImports = componentRenderContext.mappedImports
    .map((mappedImport) => `import ${mappedImport.localName} from "${mappedImport.modulePath}";`)
    .join("\n");
  const routerImports: string[] = componentRenderContext.usesRouterLink ? ["Link as RouterLink"] : [];
  const reactRouterImport = routerImports.length > 0 ? `import { ${routerImports.join(", ")} } from "react-router-dom";\n` : "";
  const patternContextImport = patternContextSpec
    ? `import { ${patternContextSpec.hookName} } from "${patternContextSpec.importPath}";\n`
    : "";
  const navigationHookBlock = "";
  const sortedBindings = [...cluster.propBindings].sort((left, right) => left.propName.localeCompare(right.propName));
  const propsInterfaceEntries = usesPatternContext
    ? ["  instanceId: string;", "  sx?: SxProps<Theme>;"].join("\n")
    : ["  sx?: SxProps<Theme>;", ...sortedBindings.map((binding) => `  ${binding.propName}${binding.optional ? "?" : ""}: string;`)].join(
        "\n"
      );
  const parameterEntries = usesPatternContext ? ["instanceId", "sx"] : ["sx", ...sortedBindings.map((binding) => binding.propName)];
  const patternContextBindingBlock = patternContextSpec
    ? [
        `const patternContext = ${patternContextSpec.hookName}();`,
        `const patternState = patternContext.${cluster.componentName}[instanceId];`,
        ...sortedBindings.map((binding) => {
          const fallbackSuffix = binding.kind === "image_src" ? "" : ' ?? ""';
          return `const ${binding.propName} = patternState?.${binding.propName}${fallbackSuffix};`;
        })
      ].join("\n")
    : "";
  const componentSetupBlock = [patternContextBindingBlock, navigationHookBlock]
    .filter((block) => block.length > 0)
    .join("\n\n");
  const componentSource = `${reactRouterImport}${patternContextImport}import type { SxProps, Theme } from "@mui/material/styles";
import { ${sortedMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}

interface ${cluster.componentName}Props {
${propsInterfaceEntries}
}

export function ${cluster.componentName}({ ${parameterEntries.join(", ")} }: ${cluster.componentName}Props) {
${componentSetupBlock ? `${indentBlock(componentSetupBlock, 2)}\n` : ""}  return (
${renderedWithSx}
  );
}
`;
  return {
    path: path.posix.join("src", "components", ensureTsxName(cluster.componentName)),
    content: extractSharedSxConstantsFromScreenContent(componentSource)
  };
};

const buildInvocationMap = ({
  patternStatePlan,
  clusters
}: {
  patternStatePlan: ScreenPatternStatePlan;
  clusters: PatternCluster[];
}): Map<string, PatternExtractionInvocation> => {
  const byRootNodeId = new Map<string, PatternExtractionInvocation>();
  const contextEnabledComponentNames = patternStatePlan.contextFileSpec?.contextEnabledComponentNames ?? new Set<string>();
  for (const cluster of clusters) {
    const usesPatternContext = contextEnabledComponentNames.has(cluster.componentName);
    for (const member of cluster.members) {
      const propValues = Object.fromEntries(
        cluster.propBindings.map((binding) => [binding.propName, binding.valuesByRootNodeId.get(member.root.id)])
      ) as Record<string, string | undefined>;
      byRootNodeId.set(member.root.id, {
        componentName: cluster.componentName,
        instanceId: member.root.id,
        usesPatternContext,
        propValues
      });
    }
  }
  return byRootNodeId;
};

const collectExtractionCandidates = ({
  roots,
  rootParent,
  generationLocale
}: {
  roots: ScreenElementIR[];
  rootParent: VirtualParent;
  generationLocale: string;
}): ExtractionCandidate[] => {
  const candidates: ExtractionCandidate[] = [];
  const sortedRoots = toSortedChildrenForExtraction({
    children: roots,
    layoutMode: rootParent.layoutMode ?? "NONE",
    generationLocale
  });

  const visit = ({
    node,
    parent,
    depth
  }: {
    node: ScreenElementIR;
    parent: VirtualParent;
    depth: number;
  }): void => {
    const subtreeNodeIds = collectSubtreeNodeIdsForExtraction(node);
    const subtreeNodeCount = subtreeNodeIds.size;
    const children = node.children ?? [];
    if (
      EXTRACTION_CANDIDATE_TYPES.has(node.type) &&
      children.length >= 1 &&
      subtreeNodeCount >= PATTERN_MIN_SUBTREE_NODE_COUNT &&
      hasTextOrImageDescendants(node) &&
      !hasForbiddenExtractionSignals(node)
    ) {
      candidates.push({
        root: node,
        parent,
        depth,
        signature: computeStructuralSignature({
          root: node,
          generationLocale
        }),
        pathNodeMap: collectPathNodeMapForExtraction({
          root: node,
          generationLocale
        }),
        subtreeNodeIds,
        subtreeNodeCount
      });
    }

    const nextParent: VirtualParent = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      name: node.name,
      fillColor: node.fillColor,
      fillGradient: node.fillGradient,
      layoutMode: node.layoutMode ?? "NONE"
    };
    const sortedChildren = toSortedChildrenForExtraction({
      children,
      layoutMode: node.layoutMode ?? "NONE",
      generationLocale
    });
    sortedChildren.forEach((child) => {
      visit({
        node: child,
        parent: nextParent,
        depth: depth + 1
      });
    });
  };

  sortedRoots.forEach((root) => {
    visit({
      node: root,
      parent: rootParent,
      depth: 3
    });
  });

  return candidates;
};

const buildPatternClusters = ({
  candidates,
  screenComponentName,
  imageAssetMap
}: {
  candidates: ExtractionCandidate[];
  screenComponentName: string;
  imageAssetMap: Record<string, string>;
}): PatternCluster[] => {
  const sortedCandidates = [...candidates].sort((left, right) => {
    if (left.subtreeNodeCount !== right.subtreeNodeCount) {
      return right.subtreeNodeCount - left.subtreeNodeCount;
    }
    return left.root.id.localeCompare(right.root.id);
  });
  const rawClusters: ExtractionCandidate[][] = [];
  for (const candidate of sortedCandidates) {
    const matchingCluster = rawClusters.find((cluster) => {
      const prototype = cluster[0];
      if (!prototype) {
        return false;
      }
      return computeSubtreeSimilarity(prototype.signature, candidate.signature) >= PATTERN_SIMILARITY_THRESHOLD;
    });
    if (matchingCluster) {
      matchingCluster.push(candidate);
      continue;
    }
    rawClusters.push([candidate]);
  }

  const reservedSubtreeNodeIds = new Set<string>();
  const reservedRootIds = new Set<string>();
  const selectedClusters: PatternCluster[] = [];
  const sortedRawClusters = rawClusters
    .filter((cluster) => cluster.length >= PATTERN_MIN_OCCURRENCES)
    .sort((left, right) => {
      const leftSize = left[0]?.subtreeNodeCount ?? 0;
      const rightSize = right[0]?.subtreeNodeCount ?? 0;
      if (leftSize !== rightSize) {
        return rightSize - leftSize;
      }
      return (left[0]?.root.id ?? "").localeCompare(right[0]?.root.id ?? "");
    });

  let clusterIndex = 1;
  for (const cluster of sortedRawClusters) {
    const localMembers: ExtractionCandidate[] = [];
    const localRootIds = new Set<string>();
    const localSubtreeIds = new Set<string>();
    const memberCandidates = [...cluster].sort((left, right) => {
      if (left.subtreeNodeCount !== right.subtreeNodeCount) {
        return right.subtreeNodeCount - left.subtreeNodeCount;
      }
      return left.root.id.localeCompare(right.root.id);
    });

    for (const member of memberCandidates) {
      const collidesWithGlobal =
        reservedSubtreeNodeIds.has(member.root.id) ||
        hasIntersectionWithSet({ values: member.subtreeNodeIds, targets: reservedRootIds });
      if (collidesWithGlobal) {
        continue;
      }
      const collidesWithLocal =
        localSubtreeIds.has(member.root.id) || hasIntersectionWithSet({ values: member.subtreeNodeIds, targets: localRootIds });
      if (collidesWithLocal) {
        continue;
      }
      localMembers.push(member);
      localRootIds.add(member.root.id);
      for (const nodeId of member.subtreeNodeIds) {
        localSubtreeIds.add(nodeId);
      }
    }

    if (localMembers.length < PATTERN_MIN_OCCURRENCES) {
      continue;
    }
    localMembers.sort((left, right) => left.root.id.localeCompare(right.root.id));
    const propBindings = inferDynamicPropsFromCluster({
      members: localMembers,
      imageAssetMap
    });
    const [prototype] = localMembers;
    if (!prototype) {
      continue;
    }
    const componentName = `${screenComponentName}Pattern${clusterIndex}`;
    selectedClusters.push({
      componentName,
      prototype,
      members: localMembers,
      propBindings
    });
    clusterIndex += 1;
    for (const nodeId of localSubtreeIds) {
      reservedSubtreeNodeIds.add(nodeId);
    }
    for (const nodeId of localRootIds) {
      reservedRootIds.add(nodeId);
    }
  }

  return selectedClusters;
};

export const buildPatternExtractionPlan = ({
  enablePatternExtraction,
  screen,
  screenComponentName,
  roots,
  rootParent,
  generationLocale,
  spacingBase,
  tokens,
  iconResolver,
  imageAssetMap,
  routePathByScreenId,
  mappingByNodeId,
  pageBackgroundColorNormalized,
  themeComponentDefaults,
  responsiveTopLevelLayoutOverrides
}: {
  enablePatternExtraction: boolean;
  screen: ScreenIR;
  screenComponentName: string;
  roots: ScreenElementIR[];
  rootParent: VirtualParent;
  generationLocale: string;
  spacingBase: number;
  tokens: DesignTokens | undefined;
  iconResolver: IconFallbackResolver;
  imageAssetMap: Record<string, string>;
  routePathByScreenId: Map<string, string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  pageBackgroundColorNormalized: string | undefined;
  themeComponentDefaults?: ThemeComponentDefaults;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
}): PatternExtractionPlan => {
  if (!enablePatternExtraction) {
    return emptyPatternExtractionPlan();
  }
  const candidates = collectExtractionCandidates({
    roots,
    rootParent,
    generationLocale
  });
  if (candidates.length < PATTERN_MIN_OCCURRENCES) {
    return emptyPatternExtractionPlan();
  }
  const clusters = buildPatternClusters({
    candidates,
    screenComponentName,
    imageAssetMap
  });
  if (clusters.length === 0) {
    return emptyPatternExtractionPlan();
  }

  const preliminaryPatternStatePlan = buildScreenPatternStatePlan({
    screenComponentName,
    clusters
  });
  const componentFiles: GeneratedFile[] = [];
  const componentImports: ExtractedComponentImportSpec[] = [];
  const usableClusters: PatternCluster[] = [];
  for (const cluster of clusters) {
    const file = buildExtractedComponentFile({
      cluster,
      patternStatePlan: preliminaryPatternStatePlan,
      screen,
      generationLocale,
      spacingBase,
      tokens,
      iconResolver,
      imageAssetMap,
      routePathByScreenId,
      mappingByNodeId,
      pageBackgroundColorNormalized,
      ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
      ...(responsiveTopLevelLayoutOverrides ? { responsiveTopLevelLayoutOverrides } : {})
    });
    if (!file) {
      continue;
    }
    usableClusters.push(cluster);
    componentFiles.push(file);
    componentImports.push({
      componentName: cluster.componentName,
      importPath: `../components/${cluster.componentName}`
    });
  }
  if (usableClusters.length === 0) {
    return emptyPatternExtractionPlan();
  }

  const patternStatePlan = buildScreenPatternStatePlan({
    screenComponentName,
    clusters: usableClusters
  });
  const invocationByRootNodeId = buildInvocationMap({
    patternStatePlan,
    clusters: usableClusters
  });
  const contextFiles = patternStatePlan.contextFileSpec ? [patternStatePlan.contextFileSpec.file] : [];
  return {
    componentFiles,
    contextFiles,
    componentImports: componentImports.sort((left, right) => left.componentName.localeCompare(right.componentName)),
    invocationByRootNodeId,
    patternStatePlan
  };
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
    (typeof node.fontSize === "number" && node.fontSize >= 20) ||
    (typeof node.fontWeight === "number" && node.fontWeight >= 650)
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
    return mappedSource.trim();
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

const hasSubtreeName = (element: ScreenElementIR, pattern: string): boolean => {
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

export interface InteractiveFieldModel {
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
  formGroupId?: string | undefined;
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

export interface IconFallbackResolver {
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

interface ExtractedComponentImportSpec {
  componentName: string;
  importPath: string;
}

export interface PatternExtractionInvocation {
  componentName: string;
  instanceId: string;
  usesPatternContext: boolean;
  propValues: Record<string, string | undefined>;
}

interface PatternInvocationStateEntry {
  instanceId: string;
  values: Record<string, string | undefined>;
}

interface PatternContextClusterStateSpec {
  componentName: string;
  stateTypeName: string;
  propBindings: DynamicPropBinding[];
  entries: PatternInvocationStateEntry[];
}

export interface PatternContextFileSpec {
  file: GeneratedFile;
  providerName: string;
  hookName: string;
  stateTypeName: string;
  importPath: string;
  initialStateLiteral: string;
  contextEnabledComponentNames: Set<string>;
}

export interface FormContextFileSpec {
  file: GeneratedFile;
  providerName: string;
  hookName: string;
  importPath: string;
}

interface ScreenPatternStatePlan {
  contextFileSpec?: PatternContextFileSpec;
}

type DynamicPropBindingKind = "text" | "image_src" | "image_alt";

interface DynamicPropBinding {
  kind: DynamicPropBindingKind;
  path: string;
  propName: string;
  optional: boolean;
  placeholder: string;
  valuesByRootNodeId: Map<string, string | undefined>;
}

interface ExtractionCandidate {
  root: ScreenElementIR;
  parent: VirtualParent;
  depth: number;
  signature: Set<string>;
  pathNodeMap: Map<string, ScreenElementIR>;
  subtreeNodeIds: Set<string>;
  subtreeNodeCount: number;
}

interface PatternCluster {
  componentName: string;
  prototype: ExtractionCandidate;
  members: ExtractionCandidate[];
  propBindings: DynamicPropBinding[];
}

export interface PatternExtractionPlan {
  componentFiles: GeneratedFile[];
  contextFiles: GeneratedFile[];
  componentImports: ExtractedComponentImportSpec[];
  invocationByRootNodeId: Map<string, PatternExtractionInvocation>;
  patternStatePlan: ScreenPatternStatePlan;
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
  generationLocale: string;
  formHandlingMode: ResolvedFormHandlingMode;
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
  themeComponentDefaults?: ThemeComponentDefaults;
  themeSxSampleCollector?: ThemeSxSampleCollector;
  responsiveTopLevelLayoutOverrides?: Record<string, ScreenResponsiveLayoutOverridesByBreakpoint>;
  extractionInvocationByNodeId: Map<string, PatternExtractionInvocation>;
  currentFormGroupId?: string | undefined;
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

export const renderMappedElement = (
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

export const toStateKey = (element: ScreenElementIR): string => {
  const source = `${element.name}_${element.id}`.toLowerCase();
  const normalized = source.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "field";
};

export const ensureTabsStateModel = ({
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

export const ensureDialogStateModel = ({
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

export const deriveSelectOptions = (defaultValue: string, generationLocale: string): string[] => {
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

const VALIDATION_ONLY_TYPE_RULES: Array<{
  type: ValidationFieldType;
  patterns: RegExp[];
  placeholderPatterns?: RegExp[];
}> = [
  {
    type: "iban",
    patterns: [/\biban\b/],
    placeholderPatterns: [/^[A-Z]{2}\d{2}\s/]
  },
  {
    type: "plz",
    patterns: [/\bplz\b/, /\bpostleitzahl\b/, /\bpostal\s*code\b/, /\bzip\s*code\b/, /\bzip\b/, /\bpostcode\b/]
  },
  {
    type: "credit_card",
    patterns: [
      /\bcredit\s*card\b/,
      /\bkreditkarte\b/,
      /\bcard\s*number\b/,
      /\bkartennummer\b/,
      /\bcc\s*number\b/
    ],
    placeholderPatterns: [/^\d{4}\s\d{4}\s\d{4}\s\d{4}$/]
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

export const normalizeInputSemanticText = (value: string): string => {
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

const inferValidationOnlyType = ({
  hints,
  placeholder
}: {
  hints: string[];
  placeholder: string | undefined;
}): ValidationFieldType | undefined => {
  for (const rule of VALIDATION_ONLY_TYPE_RULES) {
    if (hints.some((hint) => rule.patterns.some((pattern) => pattern.test(hint)))) {
      return rule.type;
    }
    if (
      placeholder &&
      rule.placeholderPatterns &&
      rule.placeholderPatterns.some((pattern) => pattern.test(placeholder.trim()))
    ) {
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

export const inferRequiredFromLabel = (label: string): boolean => {
  return /(?:^|\s)\*(?:\s|$)|\*\s*$/.test(label);
};

export const sanitizeRequiredLabel = (label: string): string => {
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
    case "iban":
      return "Please enter a valid IBAN.";
    case "plz":
      return "Please enter a valid postal code.";
    case "credit_card":
      return "Please enter a valid card number.";
    default:
      return undefined;
  }
};

export const inferVisualErrorFromOutline = (element: ScreenElementIR): boolean => {
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

export const isLikelyInputContainer = (element: ScreenElementIR): boolean => {
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

export const isLikelyAccordionContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  return hasAnySubtreeName(element, ACCORDION_NAME_HINTS) && hasSubtreeName(element, "collapsewrapper");
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

export const ICON_FALLBACK_BUILTIN_RESOLVER: IconFallbackResolver = compileIconFallbackResolver({
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

const toSequentialDeltas = (values: number[]): number[] => {
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

export const registerInteractiveField = ({
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
  const validationOnlyType = isSelect ? undefined : inferValidationOnlyType({ hints: semanticHints, placeholder });
  const validationType = isSelect ? undefined : (validationOnlyType ?? inputType);
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
    valueColor: model.valueNode?.fillColor,
    ...(context.currentFormGroupId ? { formGroupId: context.currentFormGroupId } : {})
  };
  context.fields.push(created);
  return created;
};

const subtreeContainsType = (element: ScreenElementIR, targetType: string): boolean => {
  if (element.type === targetType) {
    return true;
  }
  return (element.children ?? []).some((child) => subtreeContainsType(child, targetType));
};

export interface FormGroupAssignment {
  groupId: string;
  childIndices: number[];
}

export const detectFormGroups = (simplifiedChildren: ScreenElementIR[]): FormGroupAssignment[] => {
  if (simplifiedChildren.length === 0) {
    return [];
  }

  const childSignals = simplifiedChildren.map((child) => ({
    hasInput: subtreeContainsType(child, "input"),
    hasButton: subtreeContainsType(child, "button")
  }));

  const totalInputChildren = childSignals.filter((signal) => signal.hasInput).length;
  const totalButtonChildren = childSignals.filter((signal) => signal.hasButton).length;

  if (totalInputChildren <= 1 || totalButtonChildren <= 1) {
    return [];
  }

  const groups: FormGroupAssignment[] = [];
  let currentGroup: { indices: number[]; hasInput: boolean; hasButton: boolean } | undefined;

  for (let index = 0; index < simplifiedChildren.length; index += 1) {
    const signal = childSignals[index];
    if (!signal) {
      continue;
    }
    const isFormRelated = signal.hasInput || signal.hasButton;

    if (!isFormRelated) {
      if (currentGroup && currentGroup.hasInput && !currentGroup.hasButton) {
        currentGroup.indices.push(index);
      } else if (currentGroup && currentGroup.hasInput && currentGroup.hasButton) {
        groups.push({
          groupId: `formGroup${groups.length}`,
          childIndices: currentGroup.indices
        });
        currentGroup = undefined;
      }
      continue;
    }

    if (!currentGroup) {
      currentGroup = { indices: [index], hasInput: signal.hasInput, hasButton: signal.hasButton };
      continue;
    }

    if (currentGroup.hasInput && currentGroup.hasButton && signal.hasInput) {
      groups.push({
        groupId: `formGroup${groups.length}`,
        childIndices: currentGroup.indices
      });
      currentGroup = { indices: [index], hasInput: signal.hasInput, hasButton: signal.hasButton };
      continue;
    }

    currentGroup.indices.push(index);
    currentGroup.hasInput = currentGroup.hasInput || signal.hasInput;
    currentGroup.hasButton = currentGroup.hasButton || signal.hasButton;
  }

  if (currentGroup && currentGroup.hasInput && currentGroup.hasButton) {
    groups.push({
      groupId: `formGroup${groups.length}`,
      childIndices: currentGroup.indices
    });
  }

  if (groups.length <= 1) {
    return [];
  }

  return groups;
};

export const registerInteractiveAccordion = ({
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

export const buildSemanticInputModel = (element: ScreenElementIR): SemanticInputModel => {
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

interface ResolvedPrototypeNavigation {
  routePath: string;
  replace: boolean;
}

export const resolvePrototypeNavigationBinding = ({
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

export const toRouterLinkProps = ({
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

export const toNavigateHandlerProps = ({
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
      ' onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ' +
      `${navigateCall}; } }}`,
    roleProp: ' role="button"',
    tabIndexProp: " tabIndex={0}"
  };
};

const NAVIGATION_BAR_CANDIDATE_TYPES = new Set<ScreenElementIR["type"]>(["container", "stack", "table"]);
export const NAVIGATION_BAR_TOP_LEVEL_DEPTH = 3;
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

export interface ListRowAnalysis {
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

export const analyzeListRow = ({
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

export const collectListRows = (element: ScreenElementIR, generationLocale?: string): ListRowCollection => {
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

export const detectRepeatedListPattern = ({
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
  const yDeltas = toSequentialDeltas(rowYValues);
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

export const toListSecondaryActionExpression = ({
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

export const isRenderableTabAction = ({
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
  const gaps = toSequentialDeltas(centerXValues);
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

export const detectTabInterfacePattern = ({
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

export const detectDialogOverlayPattern = ({
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

export const detectNavigationBarPattern = ({
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

const writeGeneratedFile = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  if (!absolutePath.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error(`LLM attempted path traversal: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

const GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL = Symbol.for(
  "workspace-dev.parity.generateArtifacts.runtimeAdapters"
);

type LoadedDesignSystemConfig = Awaited<ReturnType<typeof loadDesignSystemConfigFile>>;
type ApplyDesignSystemMappingsInput = Parameters<typeof applyDesignSystemMappingsToGeneratedTsx>[0];

interface GenerateArtifactsRuntimeAdapters {
  mkdirRecursive: (directory: string) => Promise<void>;
  writeTextFile: ({ filePath, content }: { filePath: string; content: string }) => Promise<void>;
  writeGeneratedFile: (rootDir: string, file: GeneratedFile) => Promise<void>;
  loadDesignSystemConfig: ({
    designSystemFilePath,
    onLog
  }: {
    designSystemFilePath: string;
    onLog: (message: string) => void;
  }) => Promise<LoadedDesignSystemConfig>;
  applyDesignSystemMappings: (input: ApplyDesignSystemMappingsInput) => string;
  loadIconResolver: ({
    iconMapFilePath,
    onLog
  }: {
    iconMapFilePath: string;
    onLog: (message: string) => void;
  }) => Promise<IconFallbackResolver>;
}

const DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS: GenerateArtifactsRuntimeAdapters = {
  mkdirRecursive: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  writeTextFile: async ({ filePath, content }) => {
    await writeFile(filePath, content, "utf-8");
  },
  writeGeneratedFile: async (rootDir, file) => {
    await writeGeneratedFile(rootDir, file);
  },
  loadDesignSystemConfig: async ({ designSystemFilePath, onLog }) => {
    return loadDesignSystemConfigFile({
      designSystemFilePath,
      onLog
    });
  },
  applyDesignSystemMappings: (input) => {
    return applyDesignSystemMappingsToGeneratedTsx(input);
  },
  loadIconResolver: async ({ iconMapFilePath, onLog }) => {
    return loadIconFallbackResolver({
      iconMapFilePath,
      onLog
    });
  }
};

const resolveGenerateArtifactsRuntimeAdapters = (input: GenerateArtifactsInput): GenerateArtifactsRuntimeAdapters => {
  if (input.context) {
    return input.context.runtimeAdapters;
  }
  const candidate = (input as unknown as Record<PropertyKey, unknown>)[GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL];
  if (!candidate || typeof candidate !== "object") {
    return DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS;
  }
  const partial = candidate as Partial<GenerateArtifactsRuntimeAdapters>;
  return {
    mkdirRecursive: partial.mkdirRecursive ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.mkdirRecursive,
    writeTextFile: partial.writeTextFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeTextFile,
    writeGeneratedFile: partial.writeGeneratedFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeGeneratedFile,
    loadDesignSystemConfig:
      partial.loadDesignSystemConfig ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadDesignSystemConfig,
    applyDesignSystemMappings:
      partial.applyDesignSystemMappings ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.applyDesignSystemMappings,
    loadIconResolver: partial.loadIconResolver ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadIconResolver
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

interface GenerateArtifactsResolvedPhase {
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  resolvedFormHandlingMode: ResolvedFormHandlingMode;
  transformGeneratedFileWithDesignSystem: (file: GeneratedFile) => GeneratedFile;
}

const resolveGenerateArtifactsPhase = async ({
  input,
  generationLocale,
  formHandlingMode,
  llmModelName,
  llmCodegenMode,
  designSystemFilePath,
  onLog
}: {
  input: GenerateArtifactsInput;
  generationLocale: string | undefined;
  formHandlingMode: WorkspaceFormHandlingMode | undefined;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  designSystemFilePath: string;
  onLog: (message: string) => void;
}): Promise<GenerateArtifactsResolvedPhase> => {
  void llmModelName;
  if (llmCodegenMode !== "deterministic") {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: "Only deterministic code generation is supported in workspace-dev."
    });
  }
  const runtimeAdapters = resolveGenerateArtifactsRuntimeAdapters(input);
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
  const resolvedFormHandlingMode = resolveFormHandlingMode({
    requestedMode: formHandlingMode
  });
  const designSystemConfig = await runtimeAdapters.loadDesignSystemConfig({
    designSystemFilePath,
    onLog
  });
  const transformGeneratedFileWithDesignSystem = (file: GeneratedFile): GeneratedFile => {
    if (!designSystemConfig) {
      return file;
    }
    const transformedContent = runtimeAdapters.applyDesignSystemMappings({
      filePath: file.path,
      content: file.content,
      config: designSystemConfig
    });
    return transformedContent === file.content
      ? file
      : {
          ...file,
          content: transformedContent
        };
  };
  return {
    runtimeAdapters,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    transformGeneratedFileWithDesignSystem
  };
};

interface GenerateArtifactsStatePhase {
  generatedPaths: Set<string>;
  generationMetrics: GenerationMetrics;
  truncationByScreenId: Map<string, {
    screenId: string;
    screenName: string;
    originalElements: number;
    retainedElements: number;
    budget: number;
  }>;
  allIrNodeIds: Set<string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
}

const initializeGenerateArtifactsStatePhase = ({
  ir,
  componentMappings
}: {
  ir: DesignIR;
  componentMappings: ComponentMappingRule[] | undefined;
}): GenerateArtifactsStatePhase => {
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
  return {
    generatedPaths,
    generationMetrics,
    truncationByScreenId,
    allIrNodeIds,
    mappingByNodeId,
    mappingWarnings
  };
};

interface GenerateArtifactsBasePhase {
  iconResolver: IconFallbackResolver;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
}

const runGenerateArtifactsBasePhase = async ({
  projectDir,
  ir,
  iconMapFilePath,
  resolvedGenerationLocale,
  runtimeAdapters,
  generatedPaths,
  onLog
}: {
  projectDir: string;
  ir: DesignIR;
  iconMapFilePath: string;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  generatedPaths: Set<string>;
  onLog: (message: string) => void;
}): Promise<GenerateArtifactsBasePhase> => {
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "screens"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "context"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "theme"));
  const iconResolver = await runtimeAdapters.loadIconResolver({
    iconMapFilePath,
    onLog
  });
  const themeComponentDefaults = deriveThemeComponentDefaultsFromIr({
    ir,
    generationLocale: resolvedGenerationLocale.locale
  });
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "src", "theme", "tokens.json"),
    content: JSON.stringify(ir.tokens, null, 2)
  });
  generatedPaths.add("src/theme/tokens.json");
  const deterministicTheme = fallbackThemeFile(ir, themeComponentDefaults);
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);
  const deterministicErrorBoundary = makeErrorBoundaryFile();
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicErrorBoundary);
  generatedPaths.add(deterministicErrorBoundary.path);
  const deterministicScreenSkeleton = makeScreenSkeletonFile();
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicScreenSkeleton);
  generatedPaths.add(deterministicScreenSkeleton.path);
  return {
    iconResolver,
    themeComponentDefaults
  };
};

interface DeterministicScreenPersistedArtifact {
  file: GeneratedFile;
  componentFiles: GeneratedFile[];
  contextFiles: GeneratedFile[];
  testFiles: GeneratedFile[];
}

interface GenerateArtifactsScreenPhase {
  deterministicScreens: DeterministicScreenPersistedArtifact[];
  identitiesByScreenId: Map<string, ScreenArtifactIdentity>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
  accessibilityWarnings: AccessibilityWarning[];
  simplificationByScreen: ScreenSimplificationMetric[];
  aggregatedSimplificationStats: SimplificationMetrics;
  prototypeNavigationRenderedCount: number;
}

const runGenerateArtifactsScreenPhase = ({
  ir,
  mappingByNodeId,
  truncationByScreenId,
  imageAssetMap,
  resolvedGenerationLocale,
  resolvedFormHandlingMode,
  iconResolver,
  themeComponentDefaults,
  transformGeneratedFileWithDesignSystem,
  onLog
}: {
  ir: DesignIR;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  truncationByScreenId: Map<string, {
    screenId: string;
    screenName: string;
    originalElements: number;
    retainedElements: number;
    budget: number;
  }>;
  imageAssetMap: Record<string, string>;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  resolvedFormHandlingMode: ResolvedFormHandlingMode;
  iconResolver: IconFallbackResolver;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
  transformGeneratedFileWithDesignSystem: (file: GeneratedFile) => GeneratedFile;
  onLog: (message: string) => void;
}): GenerateArtifactsScreenPhase => {
  const identitiesByScreenId = buildScreenArtifactIdentities(ir.screens);
  const routePathByScreenId = new Map(
    Array.from(identitiesByScreenId.entries()).map(([screenId, identity]) => [screenId, identity.routePath] as const)
  );
  const usedMappingNodeIds = new Set<string>();
  const mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }> = [];
  const accessibilityWarnings: AccessibilityWarning[] = [];
  const simplificationByScreen: ScreenSimplificationMetric[] = [];
  const aggregatedSimplificationStats = createEmptySimplificationStats();
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
      formHandlingMode: resolvedFormHandlingMode,
      ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
      ...(identity?.componentName ? { componentNameOverride: identity.componentName } : {}),
      ...(identity?.filePath ? { filePathOverride: identity.filePath } : {}),
      ...(truncationMetric ? { truncationMetric } : {})
    });
    accumulateSimplificationStats({
      target: aggregatedSimplificationStats,
      source: deterministicScreen.simplificationStats
    });
    simplificationByScreen.push({
      screenId: screen.id,
      screenName: screen.name,
      ...deterministicScreen.simplificationStats
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
      file: transformGeneratedFileWithDesignSystem(deterministicScreen.file),
      componentFiles: deterministicScreen.componentFiles.map((file) => transformGeneratedFileWithDesignSystem(file)),
      contextFiles: deterministicScreen.contextFiles,
      testFiles: deterministicScreen.testFiles
    };
  });
  return {
    deterministicScreens,
    identitiesByScreenId,
    usedMappingNodeIds,
    mappingWarnings,
    accessibilityWarnings,
    simplificationByScreen,
    aggregatedSimplificationStats,
    prototypeNavigationRenderedCount
  };
};

const persistGenerateArtifactsScreenPhase = async ({
  projectDir,
  deterministicScreens,
  runtimeAdapters,
  generatedPaths
}: {
  projectDir: string;
  deterministicScreens: DeterministicScreenPersistedArtifact[];
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  generatedPaths: Set<string>;
}): Promise<void> => {
  await Promise.all(
    deterministicScreens
      .flatMap((item) => [item.file, ...item.componentFiles, ...item.contextFiles, ...item.testFiles])
      .map(async (file) => {
        await runtimeAdapters.writeGeneratedFile(projectDir, file);
        generatedPaths.add(file.path);
      })
  );
};

const appendGenerateArtifactsMappingWarnings = ({
  mappingByNodeId,
  allIrNodeIds,
  usedMappingNodeIds,
  mappingWarnings
}: {
  mappingByNodeId: Map<string, ComponentMappingRule>;
  allIrNodeIds: Set<string>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
}): void => {
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
};

export const generateArtifacts = async (input: GenerateArtifactsInput): Promise<GenerateArtifactsResult> => {
  const irValidation = validateDesignIR(input.ir);
  if (!irValidation.valid) {
    throw new WorkflowError({
      code: "E_IR_VALIDATION",
      message: `IR validation failed: ${irValidation.errors.map((e) => e.message).join("; ")}`
    });
  }
  const {
    projectDir,
    ir,
    componentMappings,
    iconMapFilePath = path.join(projectDir, ICON_FALLBACK_FILE_NAME),
    designSystemFilePath = getDefaultDesignSystemConfigPath({ outputRoot: projectDir }),
    imageAssetMap = {},
    generationLocale,
    routerMode,
    formHandlingMode,
    llmModelName,
    llmCodegenMode,
    onLog
  } = input;
  const {
    runtimeAdapters,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    transformGeneratedFileWithDesignSystem
  } = await resolveGenerateArtifactsPhase({
    input,
    generationLocale,
    formHandlingMode,
    llmModelName,
    llmCodegenMode,
    designSystemFilePath,
    onLog
  });
  const {
    generatedPaths,
    generationMetrics,
    truncationByScreenId,
    allIrNodeIds,
    mappingByNodeId,
    mappingWarnings
  } = initializeGenerateArtifactsStatePhase({
    ir,
    componentMappings
  });
  const { iconResolver, themeComponentDefaults } = await runGenerateArtifactsBasePhase({
    projectDir,
    ir,
    iconMapFilePath,
    resolvedGenerationLocale,
    runtimeAdapters,
    generatedPaths,
    onLog
  });
  const {
    deterministicScreens,
    identitiesByScreenId,
    usedMappingNodeIds,
    mappingWarnings: screenPhaseMappingWarnings,
    accessibilityWarnings,
    simplificationByScreen,
    aggregatedSimplificationStats,
    prototypeNavigationRenderedCount
  } = runGenerateArtifactsScreenPhase({
    ir,
    mappingByNodeId,
    truncationByScreenId,
    imageAssetMap,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    iconResolver,
    themeComponentDefaults,
    transformGeneratedFileWithDesignSystem,
    onLog
  });
  mappingWarnings.push(...screenPhaseMappingWarnings);
  await persistGenerateArtifactsScreenPhase({
    projectDir,
    deterministicScreens,
    runtimeAdapters,
    generatedPaths
  });
  appendGenerateArtifactsMappingWarnings({
    mappingByNodeId,
    allIrNodeIds,
    usedMappingNodeIds,
    mappingWarnings
  });
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "src", "App.tsx"),
    content: makeAppFile({
      screens: ir.screens,
      identitiesByScreenId,
      ...(routerMode !== undefined ? { routerMode } : {})
    })
  });
  generatedPaths.add("src/App.tsx");

  generationMetrics.prototypeNavigationRendered = prototypeNavigationRenderedCount;
  generationMetrics.simplification = {
    aggregate: aggregatedSimplificationStats,
    screens: simplificationByScreen
  };
  const generationMetricsPayload = {
    ...generationMetrics,
    accessibilityWarnings
  };
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "generation-metrics.json"),
    content: `${JSON.stringify(generationMetricsPayload, null, 2)}\n`
  });
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
  onLog(
    `Simplify stats: removedEmptyNodes=${aggregatedSimplificationStats.removedEmptyNodes}, promotedSingleChild=${aggregatedSimplificationStats.promotedSingleChild}, promotedGroupMultiChild=${aggregatedSimplificationStats.promotedGroupMultiChild}, spacingMerges=${aggregatedSimplificationStats.spacingMerges}, guardedSkips=${aggregatedSimplificationStats.guardedSkips}`
  );
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
